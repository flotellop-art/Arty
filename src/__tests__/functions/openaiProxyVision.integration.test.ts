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

  it('refuse URL distante et body annoncé >24 Mio avant tout appel OpenAI', async () => {
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

  it('refuse immédiatement une vision concurrente sans lire son body puis rend le permis', async () => {
    let releaseFirst!: () => void
    let notifyFirst!: () => void
    const firstEntered = new Promise<void>((resolve) => { notifyFirst = resolve })
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let upstreamCalls = 0
    installFetch(async (init) => {
      upstreamCalls += 1
      await new Response(init?.body ?? null).arrayBuffer()
      if (upstreamCalls === 1) {
        notifyFirst()
        await firstGate
      }
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
    })

    const first = onRequestPost(context(request(visionBody()), true))
    await firstEntered

    let pulls = 0
    const concurrentCancel = vi.fn(() => new Promise<void>(() => undefined))
    const unreadBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new TextEncoder().encode(visionBody()))
        controller.close()
      },
      cancel: concurrentCancel,
    }, { highWaterMark: 0 })
    const concurrentRequest = new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-google-token': TOKEN,
        'x-openai-key': 'sk-user-key',
        'x-arty-vision': '1',
      },
      body: unreadBody,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    const busy = await onRequestPost(context(concurrentRequest, true))
    expect(busy.status).toBe(429)
    await expect(busy.json()).resolves.toMatchObject({ error: 'vision_busy' })
    expect(pulls).toBe(0)
    expect(concurrentCancel).toHaveBeenCalledOnce()
    expect(upstreamCalls).toBe(1)

    releaseFirst()
    expect((await first).status).toBe(200)
    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
    expect(upstreamCalls).toBe(2)
  })

  it('rend le permis quand l’upstream annule le body après une lecture partielle', async () => {
    let upstreamCalls = 0
    installFetch(async (init) => {
      upstreamCalls += 1
      const reader = (init?.body as ReadableStream<Uint8Array>).getReader()
      await reader.read()
      await reader.cancel('upstream_early_response')
      return new Response('early', { status: 200, headers: { 'content-type': 'text/plain' } })
    })

    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
    expect(upstreamCalls).toBe(2)
  })

  it('annule un body lent à la deadline et rend ensuite le permis', async () => {
    vi.useFakeTimers()
    try {
      installFetch(async (init) => {
        await new Response(init?.body ?? null).arrayBuffer()
        return new Response('ok', { status: 200 })
      })
      let notifyPull!: () => void
      const pullStarted = new Promise<void>((resolve) => { notifyPull = resolve })
      const cancel = vi.fn(() => new Promise<void>(() => undefined))
      const slowBody = new ReadableStream<Uint8Array>({
        pull() {
          notifyPull()
          return new Promise<void>(() => undefined)
        },
        cancel,
      }, { highWaterMark: 0 })
      const slowRequest = new Request('https://tryarty.com/api/ai/openai-proxy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-google-token': TOKEN,
          'x-openai-key': 'sk-user-key',
          'x-arty-vision': '1',
        },
        body: slowBody,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' })

      const pending = onRequestPost(context(slowRequest, true))
      await pullStarted
      await vi.advanceTimersByTimeAsync(120_000)
      const timedOut = await pending
      expect(timedOut.status).toBe(408)
      await expect(timedOut.json()).resolves.toMatchObject({ error: 'vision_request_timeout' })
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }

    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
  })

  it('englobe la résolution d’identité initiale dans la deadline globale', async () => {
    vi.useFakeTimers()
    let tokeninfoCalls = 0
    let notifyIdentity!: () => void
    const identityEntered = new Promise<void>((resolve) => { notifyIdentity = resolve })
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/tokeninfo')) {
        tokeninfoCalls += 1
        if (tokeninfoCalls === 1) {
          notifyIdentity()
          return await new Promise<Response>(() => undefined)
        }
        return Response.json({ aud: CLIENT_ID, email: 'vision@example.test', email_verified: true })
      }
      if (url.includes('/oauth2/v2/userinfo')) {
        return Response.json({ email: 'vision@example.test', verified_email: true, id: 'sub' })
      }
      if (url.includes('api.openai.com')) {
        await new Response(init?.body ?? null).arrayBuffer()
        return new Response('ok', { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
    let identityBodyPulls = 0
    const identityBodyCancel = vi.fn(() => new Promise<void>(() => undefined))
    const identityBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        identityBodyPulls += 1
        controller.enqueue(new TextEncoder().encode(visionBody()))
        controller.close()
      },
      cancel: identityBodyCancel,
    }, { highWaterMark: 0 })
    const identityRequest = new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-google-token': TOKEN,
        'x-openai-key': 'sk-user-key',
        'x-arty-vision': '1',
      },
      body: identityBody,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    try {
      const pending = onRequestPost(context(identityRequest, true))
      await identityEntered
      await vi.advanceTimersByTimeAsync(120_000)
      const timedOut = await pending
      expect(timedOut.status).toBe(408)
      expect(identityBodyPulls).toBe(0)
      expect(identityBodyCancel).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }

    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
  })

  it('interrompt un fetch upstream bloqué à la deadline et rend ensuite le permis', async () => {
    vi.useFakeTimers()
    let upstreamCalls = 0
    let notifyUpstream!: () => void
    const upstreamEntered = new Promise<void>((resolve) => { notifyUpstream = resolve })
    installFetch(async (init) => {
      upstreamCalls += 1
      if (upstreamCalls === 1) {
        notifyUpstream()
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      }
      await new Response(init?.body ?? null).arrayBuffer()
      return new Response('ok', { status: 200 })
    })
    try {
      const pending = onRequestPost(context(request(visionBody()), true))
      await upstreamEntered
      await vi.advanceTimersByTimeAsync(120_000)
      const timedOut = await pending
      expect(timedOut.status).toBe(408)
      await expect(timedOut.json()).resolves.toMatchObject({ error: 'vision_request_timeout' })
    } finally {
      vi.useRealTimers()
    }

    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
    expect(upstreamCalls).toBe(2)
  })

  it('rend 413 sans attendre EOF quand le flux réel dépasse 24 Mio', async () => {
    installFetch(async (init) => {
      await new Response(init?.body ?? null).arrayBuffer()
      return new Response('ok', { status: 200 })
    })
    const padding = new Uint8Array(1024 * 1024).fill(0x20)
    let emitted = 0
    const cancel = vi.fn()
    const oversizedOpenBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted <= OPENAI_CHAT_BODY_MAX_BYTES) {
          emitted += padding.byteLength
          controller.enqueue(padding)
          return
        }
        return new Promise<void>(() => undefined)
      },
      cancel,
    }, { highWaterMark: 0 })
    const oversizedRequest = new Request('https://tryarty.com/api/ai/openai-proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-google-token': TOKEN,
        'x-openai-key': 'sk-user-key',
        'x-arty-vision': '1',
      },
      body: oversizedOpenBody,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const rejected = await onRequestPost(context(oversizedRequest, true))
    expect(rejected.status).toBe(413)
    await expect(rejected.json()).resolves.toMatchObject({ error: 'payload_too_large' })
    expect(cancel).toHaveBeenCalledOnce()
    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
  })

  it('rend 408 et libère le permis si une dépendance Google reste pending', async () => {
    vi.useFakeTimers()
    let tokeninfoCalls = 0
    let notifyDependency!: () => void
    const dependencyEntered = new Promise<void>((resolve) => { notifyDependency = resolve })
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/tokeninfo')) {
        tokeninfoCalls += 1
        if (tokeninfoCalls === 2) {
          notifyDependency()
          return await new Promise<Response>(() => undefined)
        }
        return Response.json({ aud: CLIENT_ID, email: 'vision@example.test', email_verified: true })
      }
      if (url.includes('/oauth2/v2/userinfo')) {
        return Response.json({ email: 'vision@example.test', verified_email: true, id: 'sub' })
      }
      if (url.includes('api.openai.com')) {
        await new Response(init?.body ?? null).arrayBuffer()
        return new Response('ok', { status: 200 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
    try {
      const serverRequest = new Request('https://tryarty.com/api/ai/openai-proxy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-google-token': TOKEN,
          'x-arty-vision': '1',
        },
        body: visionBody(),
      })
      const pending = onRequestPost({
        request: serverRequest,
        env: {
          GOOGLE_CLIENT_ID: CLIENT_ID,
          OPENAI_VISION_ENABLED: 'true',
          OPENAI_API_KEY: 'sk-server',
          ALLOWED_EMAILS: 'vision@example.test',
        },
        waitUntil: vi.fn(),
      } as never)
      await dependencyEntered
      await vi.advanceTimersByTimeAsync(120_000)
      const timedOut = await pending
      expect(timedOut.status).toBe(408)
    } finally {
      vi.useRealTimers()
    }

    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
  })

  it('nettoie le body et le permis après une exception avant l’upstream', async () => {
    installFetch(async (init) => {
      await new Response(init?.body ?? null).arrayBuffer()
      return new Response('ok', { status: 200 })
    })
    const throwingEnv = {
      GOOGLE_CLIENT_ID: CLIENT_ID,
      OPENAI_VISION_ENABLED: 'true',
      OPENAI_API_KEY: 'sk-server',
      get DB(): never { throw new Error('dependency_failure') },
    }
    await expect(onRequestPost({
      request: new Request('https://tryarty.com/api/ai/openai-proxy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-google-token': TOKEN,
          'x-arty-vision': '1',
        },
        body: visionBody(),
      }),
      env: throwingEnv,
      waitUntil: vi.fn(),
    } as never)).rejects.toThrow('dependency_failure')

    expect((await onRequestPost(context(request(visionBody()), true))).status).toBe(200)
  })
})
