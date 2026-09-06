// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as geminiProxy } from '../../../functions/api/ai/gemini-proxy'
import { onRequestPost as openaiProxy } from '../../../functions/api/ai/openai-proxy'
import { chargeForUsageMicro } from '../../../functions/api/_lib/creditPricing'
import { creditWallet } from '../../../functions/api/_lib/wallet'
import { makeD1Harness, type D1Harness } from './d1Harness'

const EMAIL = 'wallet-proxy@example.test'
const TOKEN = 'google-access-token'
const CLIENT_ID = 'arty-client-id'

let h: D1Harness

beforeAll(async () => {
  h = await makeD1Harness({
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GEMINI_API_KEY: 'gemini-server-key',
    OPENAI_API_KEY: 'openai-server-key',
  })
})
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset()
  vi.restoreAllMocks()
  delete h.env.OPENAI_VISION_ENABLED
})

function googleIdentityResponse(url: string): Response | null {
  if (url.includes('/oauth2/v2/userinfo')) {
    return Response.json({ email: EMAIL, verified_email: true, id: 'google-sub' })
  }
  if (url.includes('/tokeninfo')) {
    return Response.json({ aud: CLIENT_ID, email: EMAIL, email_verified: true })
  }
  return null
}

function context(request: Request, background: Promise<unknown>[]) {
  return {
    request,
    env: h.env,
    waitUntil(promise: Promise<unknown>) { background.push(promise) },
  } as never
}

// Accounting assertions must read durable D1 state, not the hot-path reader
// whose intentional 250 ms deadline can return null on a busy CI runner.
function readDurableWallet() {
  return h.db.prepare(
    `SELECT balance_micro AS balanceMicro, reserved_micro AS reservedMicro
     FROM wallet WHERE user_email = ?1`,
  ).bind(EMAIL).first<{ balanceMicro: number; reservedMicro: number }>()
}

async function seedWallet(eventId: string, amountMicro = 1_000_000) {
  expect(await creditWallet(h.env, {
    provider: 'creem', eventId, email: EMAIL, amountMicro,
  })).toEqual({ status: 'credited' })
}

function square4kPngBase64(): string {
  const bytes = new Uint8Array(57)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x10, 0, 0, 0, 0x10, 0], 8)
  bytes.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33)
  bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44], 45)
  return Buffer.from(bytes).toString('base64')
}

function visionRequestBody() {
  return JSON.stringify({
    model: 'gpt-5.6-terra',
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: 100,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${square4kPngBase64()}`,
            detail: 'original',
          },
        },
        { type: 'text', text: 'Analyse.' },
      ],
    }],
  })
}

describe('wallet billing through complete proxy handlers', () => {
  it('charges measured Gemini usage for a non-streamed JSON response', async () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      audioSeconds: 0,
    }
    const model = 'gemini-2.5-flash'
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const google = googleIdentityResponse(url)
      if (google) return google
      if (url.includes('generativelanguage.googleapis.com')) {
        return Response.json({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 100 },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    await seedWallet('gemini-topup')
    const background: Promise<unknown>[] = []
    const response = await geminiProxy(context(new Request('https://tryarty.com/api/ai/gemini-proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-google-token': TOKEN },
      body: JSON.stringify({
        model,
        stream: false,
        contents: [{ role: 'user', parts: [{ text: 'Bonjour' }] }],
      }),
    }), background))
    expect(response.status).toBe(200)
    await response.text()
    await Promise.all(background)

    const expectedCharge = chargeForUsageMicro(model, usage).chargeMicro
    expect(await readDurableWallet()).toEqual({
      balanceMicro: 1_000_000 - expectedCharge,
      reservedMicro: 0,
    })
    const debit = await h.db.prepare(
      `SELECT amount_micro, meta FROM credit_ledger WHERE kind = 'debit' ORDER BY id DESC LIMIT 1`,
    ).first<{ amount_micro: number; meta: string }>()
    expect(debit?.amount_micro).toBe(-expectedCharge)
    expect(JSON.parse(debit!.meta)).toMatchObject({ usageMeasured: true, input: 1_000, output: 100 })
  })

  it('charges the full OpenAI reservation when the upstream stream is interrupted', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const google = googleIdentityResponse(url)
      if (google) return google
      if (url.includes('api.openai.com')) {
        let sent = false
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true
              controller.enqueue(new TextEncoder().encode(
                'data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
              ))
            } else {
              controller.error(new Error('upstream interrupted'))
            }
          },
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    await seedWallet('openai-topup')
    const background: Promise<unknown>[] = []
    const response = await openaiProxy(context(new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-google-token': TOKEN },
      body: JSON.stringify({
        model: 'gpt-5-mini', stream: true, max_tokens: 100,
        messages: [{ role: 'user', content: 'Bonjour' }],
      }),
    }), background))
    await expect(response.text()).rejects.toThrow('upstream interrupted')
    await Promise.all(background)

    const reservation = await h.db.prepare(
      `SELECT reserved_micro, status FROM reservation ORDER BY created_at DESC LIMIT 1`,
    ).first<{ reserved_micro: number; status: string }>()
    const debit = await h.db.prepare(
      `SELECT amount_micro, meta FROM credit_ledger WHERE kind = 'debit' ORDER BY id DESC LIMIT 1`,
    ).first<{ amount_micro: number; meta: string }>()
    expect(reservation?.status).toBe('settled')
    expect(debit?.amount_micro).toBe(-reservation!.reserved_micro)
    expect(JSON.parse(debit!.meta)).toMatchObject({
      usageMeasured: false,
      fallback: 'full_reservation',
    })
  })

  it('annule le wallet sur un 200 OpenAI sans body exploitable', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const google = googleIdentityResponse(url)
      if (google) return google
      if (url.includes('api.openai.com')) return new Response(null, { status: 200 })
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
    await seedWallet('openai-empty-topup')
    const background: Promise<unknown>[] = []
    const response = await openaiProxy(context(new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-google-token': TOKEN },
      body: JSON.stringify({
        model: 'gpt-5-mini', stream: true, max_tokens: 100,
        messages: [{ role: 'user', content: 'Bonjour' }],
      }),
    }), background))
    expect(response.status).toBe(200)
    await Promise.all(background)
    expect(await readDurableWallet()).toEqual({
      balanceMicro: 1_000_000,
      reservedMicro: 0,
    })
    const reservation = await h.db.prepare(
      `SELECT status FROM reservation ORDER BY created_at DESC LIMIT 1`,
    ).first<{ status: string }>()
    expect(reservation?.status).toBe('voided')
  })

  it('refuse quatre images 4K si le wallet ne couvre pas le hold, sans appel OpenAI', async () => {
    h.env.OPENAI_VISION_ENABLED = 'true'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const google = googleIdentityResponse(url)
      if (google) return google
      throw new Error(`Unexpected fetch: ${url}`)
    })
    global.fetch = fetchMock as typeof fetch

    await seedWallet('vision-tiny-topup', 1)
    const image = {
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${square4kPngBase64()}`, detail: 'original' },
    }
    const background: Promise<unknown>[] = []
    const response = await openaiProxy(context(new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-google-token': TOKEN, 'x-arty-vision': '1',
      },
      body: JSON.stringify({
        model: 'gpt-5.6-terra', stream: true,
        stream_options: { include_usage: true }, max_completion_tokens: 100,
        messages: [{ role: 'user', content: [image, image, image, image, { type: 'text', text: 'Compare.' }] }],
      }),
    }), background))
    expect(response.status).toBe(402)
    await Promise.all(background)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('api.openai.com'))).toBe(false)
    expect(await readDurableWallet()).toEqual({ balanceMicro: 1, reservedMicro: 0 })
  })

  it("règle la réservation vision sur l'usage OpenAI mesuré", async () => {
    h.env.OPENAI_VISION_ENABLED = 'true'
    const usage = {
      inputTokens: 1_234,
      outputTokens: 56,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      audioSeconds: 0,
    }
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const google = googleIdentityResponse(url)
      if (google) return google
      if (url.includes('api.openai.com')) {
        await new Response(init?.body ?? null).arrayBuffer()
        return new Response([
          'data: {"choices":[{"delta":{"content":"ok"}}]}',
          '',
          'data: {"choices":[],"usage":{"prompt_tokens":1234,"completion_tokens":56}}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    await seedWallet('vision-success-topup')
    const background: Promise<unknown>[] = []
    const response = await openaiProxy(context(new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-google-token': TOKEN, 'x-arty-vision': '1',
      },
      body: visionRequestBody(),
    }), background))
    expect(response.status).toBe(200)
    await response.text()
    await Promise.all(background)

    const expectedCharge = chargeForUsageMicro('gpt-5.6-terra', usage).chargeMicro
    expect(await readDurableWallet()).toEqual({
      balanceMicro: 1_000_000 - expectedCharge,
      reservedMicro: 0,
    })
    const reservations = await h.db.prepare(
      `SELECT id, status, model FROM reservation WHERE user_email = ?1`,
    ).bind(EMAIL).all<{ id: string; status: string; model: string }>()
    expect(reservations.results).toHaveLength(1)
    const reservation = reservations.results[0]
    expect(reservation).toEqual({
      id: expect.any(String), status: 'settled', model: 'gpt-5.6-terra',
    })
    const debits = await h.db.prepare(
      `SELECT amount_micro, ref_type, ref_id, model, balance_after, meta
       FROM credit_ledger WHERE user_email = ?1 AND kind = 'debit'`,
    ).bind(EMAIL).all<{
      amount_micro: number; ref_type: string; ref_id: string; model: string;
      balance_after: number; meta: string;
    }>()
    expect(debits.results).toHaveLength(1)
    expect(debits.results[0]).toEqual({
      amount_micro: -expectedCharge,
      ref_type: 'reservation', ref_id: reservation.id, model: 'gpt-5.6-terra',
      balance_after: 1_000_000 - expectedCharge, meta: expect.any(String),
    })
    expect(JSON.parse(debits.results[0].meta)).toEqual({
      input: 1_234, output: 56, cacheRead: 0, cacheCreation: 0, usageMeasured: true,
    })
  })

  it("annule intégralement la réservation vision si OpenAI refuse l'appel", async () => {
    h.env.OPENAI_VISION_ENABLED = 'true'
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const google = googleIdentityResponse(url)
      if (google) return google
      if (url.includes('api.openai.com')) {
        await new Response(init?.body ?? null).arrayBuffer()
        return Response.json({ error: { message: 'upstream refused' } }, { status: 400 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    await seedWallet('vision-refund-topup')
    const background: Promise<unknown>[] = []
    const response = await openaiProxy(context(new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-google-token': TOKEN, 'x-arty-vision': '1',
      },
      body: visionRequestBody(),
    }), background))
    expect(response.status).toBe(400)
    await Promise.all(background)

    expect(await readDurableWallet()).toEqual({
      balanceMicro: 1_000_000,
      reservedMicro: 0,
    })
    const reservation = await h.db.prepare(
      `SELECT status FROM reservation ORDER BY created_at DESC LIMIT 1`,
    ).first<{ status: string }>()
    expect(reservation?.status).toBe('voided')
  })

  it('ne réserve ni ne contacte OpenAI pour une vision invalide sur clé serveur', async () => {
    h.env.OPENAI_VISION_ENABLED = 'true'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const google = googleIdentityResponse(url)
      if (google) return google
      throw new Error(`Unexpected fetch: ${url}`)
    })
    global.fetch = fetchMock as typeof fetch
    await seedWallet('vision-invalid-topup')

    const malformed = JSON.parse(visionRequestBody()) as Record<string, unknown>
    const messages = malformed.messages as Array<{ content: Array<Record<string, unknown>> }>
    const imageUrl = messages[0].content[0].image_url as Record<string, unknown>
    imageUrl.url = 'https://example.test/photo.jpg'
    const background: Promise<unknown>[] = []
    const response = await openaiProxy(context(new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-google-token': TOKEN, 'x-arty-vision': '1',
      },
      body: JSON.stringify(malformed),
    }), background))
    expect(response.status).toBe(400)
    await Promise.all(background)

    const row = await h.db.prepare('SELECT COUNT(*) AS count FROM reservation')
      .first<{ count: number }>()
    expect(row?.count).toBe(0)
    expect(await readDurableWallet()).toEqual({
      balanceMicro: 1_000_000,
      reservedMicro: 0,
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('api.openai.com'))).toBe(false)
  })
})
