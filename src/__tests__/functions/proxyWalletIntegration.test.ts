// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as geminiProxy } from '../../../functions/api/ai/gemini-proxy'
import { onRequestPost as openaiProxy } from '../../../functions/api/ai/openai-proxy'
import { chargeForUsageMicro } from '../../../functions/api/_lib/creditPricing'
import { creditWallet } from '../../../functions/api/_lib/wallet'
import { makeD1Harness, type D1Harness } from './d1Harness'
import type { Env } from '../../../functions/env'

const EMAIL = 'wallet-proxy@example.test'
const TOKEN = 'google-access-token'
const CLIENT_ID = 'arty-client-id'

let h: D1Harness
const originalFetch = globalThis.fetch
let backgroundGroups: Promise<unknown>[][] = []
let deadline: Promise<() => void>
let releaseDeadlines = () => {}

function trackBackground(background: Promise<unknown>[], promise: Promise<unknown>) {
  // Observe rejection immediately, but retain the original promise so the
  // drain reports the error after every sibling operation has completed.
  void promise.catch(() => {})
  background.push(promise)
}

async function drainBackground(background: Promise<unknown>[]) {
  const settled = await Promise.allSettled(background)
  const errors = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (errors.length) throw new AggregateError(errors.map(result => result.reason), 'Background work failed')
}

// These are accounting/stream tests, not a host-speed benchmark. Hold only
// the 250 ms D1 deadline: real D1, auth, streams and every other timer run as
// usual. The refusal case below expires it explicitly; walletBalanceRead
// separately proves the real 249/250 ms boundary and late-result contract.
function controlD1Deadline() {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>()
  let announce!: (expire: () => void) => void
  deadline = new Promise(resolve => { announce = resolve })
  releaseDeadlines = () => {
    for (const expire of [...pending.values()]) expire()
  }
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 250) return realSetTimeout(callback, delay, ...args)
    const handle = Object.create(null) as ReturnType<typeof setTimeout>
    const expire = () => { if (pending.delete(handle)) callback(...args) }
    pending.set(handle, expire)
    announce(expire)
    return handle
  }) as typeof setTimeout)
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(handle => {
    if (!pending.delete(handle as ReturnType<typeof setTimeout>)) realClearTimeout(handle)
  })
}

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
  backgroundGroups = []
  controlD1Deadline()
  delete h.env.OPENAI_VISION_ENABLED
})
afterEach(async () => {
  try {
    // Even a failed assertion must not leak real SQL into the next reset.
    await drainBackground(backgroundGroups.flat())
  } finally {
    // Wallet's Promise.race leaves the losing timer alive after a fast read.
    // Release those callbacks only after the actual operations have drained.
    releaseDeadlines()
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  }
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

function context(request: Request, background: Promise<unknown>[], env: Env = h.env) {
  backgroundGroups.push(background)
  return {
    request,
    env,
    waitUntil(promise: Promise<unknown>) { trackBackground(background, promise) },
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
  it('drains later background work before reporting an earlier rejection', async () => {
    const jobs: Promise<unknown>[] = []
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const error = new Error('synthetic background rejection')
    trackBackground(jobs, Promise.reject(error))
    trackBackground(jobs, held)
    let finished = false
    const drained = drainBackground(jobs).then(
      () => { finished = true; return null },
      failure => { finished = true; return failure },
    )
    try {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      expect(finished).toBe(false)
    } finally {
      release()
      await drained
    }
    expect(finished).toBe(true)
    expect(await drained).toBeInstanceOf(AggregateError)
    expect((await drained as AggregateError).errors).toEqual([error])
  })

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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
    })
    global.fetch = fetchMock as typeof fetch

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
    try {
      expect(response.status).toBe(200)
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('api.openai.com'))).toHaveLength(1)
      await expect(response.text()).rejects.toThrow('upstream interrupted')
    } finally {
      await drainBackground(background)
    }

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

  it('refuses OpenAI without a reservation or debit when the balance deadline expires, even after a late real D1 result', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const google = googleIdentityResponse(String(input))
      if (google) return google
      throw new Error(`Unexpected fetch: ${String(input)}`)
    })
    global.fetch = fetchMock as typeof fetch
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await seedWallet('openai-late-balance-topup')

    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    type BalanceRow = { balance_micro: number; reserved_micro: number } | null
    let announceRead!: (read: { values: unknown[]; row: BalanceRow }) => void
    let failRead!: (error: unknown) => void
    const readCompleted = new Promise<{ values: unknown[]; row: BalanceRow }>((resolve, reject) => {
      announceRead = resolve
      failRead = reject
    })
    void readCompleted.catch(() => {})
    let delayedRead: Promise<unknown> | undefined
    let balanceReads = 0
    const realPrepare = h.db.prepare.bind(h.db)
    // Delay only delivery of the actual D1 balance SELECT. Every other query
    // and mutation still uses the original database and production handler.
    const db = new Proxy(h.db, {
      get(target, key) {
        if (key === 'prepare') return (sql: string) => {
          const statement = realPrepare(sql)
          if (sql.replace(/\s+/g, ' ').trim() !== 'SELECT balance_micro, reserved_micro FROM wallet WHERE user_email = ?1') return statement
          // A narrow facade is intentional: Miniflare RPC stubs do not
          // consistently expose method replacements made by vi.spyOn.
          return { bind(...values: unknown[]) {
            const bound = statement.bind(...values)
            return { first() {
              balanceReads += 1
              delayedRead = bound.first<BalanceRow>().then(async row => {
                announceRead({ values, row })
                await held
                return row
              }, error => {
                failRead(error)
                throw error
              })
              return delayedRead
            } }
          } } as D1PreparedStatement
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const background: Promise<unknown>[] = []
    const pending = openaiProxy(context(new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-google-token': TOKEN },
      body: JSON.stringify({
        model: 'gpt-5-mini', stream: true, max_tokens: 100,
        messages: [{ role: 'user', content: 'Bonjour' }],
      }),
    }), background, { ...h.env, DB: db }))
    const assertNoCharge = async () => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('api.openai.com'))).toHaveLength(0)
      expect(await readDurableWallet()).toEqual({ balanceMicro: 1_000_000, reservedMicro: 0 })
      expect(await h.db.prepare('SELECT COUNT(*) AS count FROM reservation').first()).toEqual({ count: 0 })
      expect(await h.db.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE kind = 'debit'").first()).toEqual({ count: 0 })
    }
    try {
      const expire = await Promise.race([
        deadline,
        pending.then(response => {
          throw new Error(`Proxy ended before the balance deadline: ${response.status}`)
        }),
      ])
      expect(await readCompleted).toEqual({
        values: [EMAIL], row: { balance_micro: 1_000_000, reserved_micro: 0 },
      })
      expire()
      const response = await pending
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: 'model_locked' })
      expect(balanceReads).toBe(1)
      expect(log).toHaveBeenCalledExactlyOnceWith('[wallet] getWalletBalance D1 timeout — traité comme pas de wallet')
      await assertNoCharge()
    } finally {
      release()
      releaseDeadlines()
      await delayedRead
      await pending
      await drainBackground(background)
    }
    expect((await pending).status).toBe(403)
    expect(balanceReads).toBe(1)
    await assertNoCharge()
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
