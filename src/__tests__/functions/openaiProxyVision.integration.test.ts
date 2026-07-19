// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/ai/openai-proxy'
import { OPENAI_CHAT_BODY_MAX_BYTES } from '../../../functions/api/_lib/boundedRequestBody'
import { OPENAI_TEXT_BODY_MAX_BYTES } from '../../../functions/api/_lib/boundedRequestBody'

const TOKEN = 'google-token'
const CLIENT_ID = 'arty-client-id'
const ORIGINAL_FETCH = global.fetch

function pngBase64(): string {
  const bytes = new Uint8Array(57)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 32, 0, 0, 0, 32], 8)
  bytes.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33)
  bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44], 45)
  return Buffer.from(bytes).toString('base64')
}

function visionBody(url = `data:image/png;base64,${pngBase64()}`) {
  return JSON.stringify({
    model: 'gpt-5.6-terra',
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url, detail: 'original' } },
        { type: 'text', text: 'Analyse.' },
      ],
    }],
  })
}

function request(body: string, contentLength?: string): Request {
  return new Request('https://tryarty.com/api/ai/openai-proxy', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-google-token': TOKEN,
      'x-openai-key': 'sk-user-key',
      'x-arty-vision': '1',
      ...(contentLength ? { 'content-length': contentLength } : {}),
    },
    body,
  })
}

function context(req: Request, visionEnabled?: boolean) {
  return {
    request: req,
    env: {
      GOOGLE_CLIENT_ID: CLIENT_ID,
      ...(visionEnabled ? { OPENAI_VISION_ENABLED: 'true' } : {}),
    },
    waitUntil: vi.fn(),
  } as never
}

function installFetch(upstream?: (init?: RequestInit) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/oauth2/v2/userinfo')) {
      return Response.json({ email: 'vision@example.test', verified_email: true, id: 'sub' })
    }
    if (url.includes('/tokeninfo')) {
      return Response.json({ aud: CLIENT_ID, email: 'vision@example.test', email_verified: true })
    }
    if (url.includes('api.openai.com') && upstream) return await upstream(init)
    throw new Error(`Unexpected fetch: ${url}`)
  })
  global.fetch = mock as typeof fetch
  return mock
}

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('openai-proxy vision — intégration fail-closed', () => {
  it('refuse via killswitch avant tout appel OpenAI', async () => {
    const fetchMock = installFetch()
    const response = await onRequestPost(context(request(visionBody())))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'vision_disabled' })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('api.openai.com'))).toBe(false)
  })

  it('refuse URL distante et body annoncé >40 Mio avant tout appel OpenAI', async () => {
    const fetchMock = installFetch()
    const invalid = await onRequestPost(context(request(visionBody('https://example.com/a.png')), true))
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ error: 'invalid_image_payload' })

    const oversized = await onRequestPost(context(
      request('{}', String(OPENAI_CHAT_BODY_MAX_BYTES + 1)),
      true,
    ))
    expect(oversized.status).toBe(413)
    await expect(oversized.json()).resolves.toMatchObject({ error: 'payload_too_large' })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('api.openai.com'))).toBe(false)
  })

  it('borne le transport texte à 10 Mio même pour un compte authentifié', async () => {
    const fetchMock = installFetch()
    const response = await onRequestPost(context(new Request(
      'https://tryarty.com/api/ai/openai-proxy',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(OPENAI_TEXT_BODY_MAX_BYTES + 1),
          'x-google-token': TOKEN,
          'x-openai-key': 'sk-user-key',
        },
        body: '{}',
      },
    ), true))
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: 'payload_too_large',
      max_bytes: OPENAI_TEXT_BODY_MAX_BYTES,
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('api.openai.com'))).toBe(false)
  })

  it('forwarde uniquement le JSON image validé quand les deux flags sont actifs', async () => {
    let forwarded: Record<string, unknown> | undefined
    installFetch(async (init) => {
      const forwardedBody = await new Response(init?.body ?? null).text()
      forwarded = JSON.parse(forwardedBody) as Record<string, unknown>
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    })
    const response = await onRequestPost(context(request(visionBody()), true))
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('ok')
    expect(forwarded).toMatchObject({ model: 'gpt-5.6-terra', stream: true })
    expect(JSON.stringify(forwarded)).toContain('"detail":"original"')
  })
})
