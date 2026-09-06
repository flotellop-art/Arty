import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequest as rootMiddleware } from '../../../functions/_middleware'
import { onRequest as apiMiddleware } from '../../../functions/api/_middleware'
import { onRequestPost as calendarAction } from '../../../functions/api/calendar/action'
import { onRequestPost as requestOtp } from '../../../functions/api/auth/email/request-otp'
import { onRequestPost as creemWebhook } from '../../../functions/api/webhook/creem'
import { onRequestPost as lemonWebhook } from '../../../functions/api/webhook/lemonsqueezy'
import type { Env } from '../../../functions/env'

// Real root/API middleware and real protected handlers, composed in Pages order.
// The terminal transport observer below is NOT an authentication substitute.
let nextIp = 1
const fetchMock = vi.fn(async () => { throw new Error('No external HTTP in this suite') })
beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('cf-connecting-ip', `192.0.2.${nextIp++}`)
  return new Request(`https://appfacade.pages.dev${path}`, { ...init, headers })
}

async function run(req: Request, handler: (req: Request) => Promise<Response>) {
  const terminal = vi.fn(() => handler(req))
  const api = vi.fn(() => apiMiddleware({ request: req, next: terminal } as never))
  const response = await rootMiddleware({ request: req, next: api } as never)
  return { response, api, terminal }
}

describe('legacy API transport through the real middleware chain', () => {
  it.each(['https://localhost', 'capacitor://localhost', 'https://tryarty.com'])('OPTIONS for %s reaches the existing CORS policy without a redirect', async (origin) => {
    const req = request('/api/subscription/status', {
      method: 'OPTIONS', headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-google-token',
      },
    })
    const { response, api, terminal } = await run(req, async () => new Response('unexpected'))
    expect(api).toHaveBeenCalledOnce()
    expect(terminal).not.toHaveBeenCalled()
    expect(response.status).toBe(204)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(response.headers.get('access-control-allow-headers')).toContain('x-google-token')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([undefined, 'null', 'https://appfacade.pages.dev', 'https://www.tryarty.com', 'https://attacker.example'])('POST with forbidden/missing Origin %s cannot reach a handler', async (origin) => {
    const req = request('/api/calendar/action', {
      method: 'POST', body: '{}', headers: origin === undefined ? {} : { Origin: origin },
    })
    const { response, terminal } = await run(req, async () => new Response('unexpected'))
    expect(response.status).toBe(403)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(terminal).not.toHaveBeenCalled()
    expect(req.bodyUsed).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a denied preflight at 204 with empty ACAO, not an allowed CORS response', async () => {
    const { response, terminal } = await run(request('/api/calendar/action', {
      method: 'OPTIONS', headers: { Origin: 'https://appfacade.pages.dev' },
    }), async () => new Response('unexpected'))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('')
    expect(response.headers.get('location')).toBeNull()
    expect(terminal).not.toHaveBeenCalled()
  })

  it('preserves the same Request, URL/query, all headers and exact POST bytes until the handler', async () => {
    const bytes = new Uint8Array([0, 10, 32, 123, 34, 195, 169, 34, 125, 255, 13, 10])
    const req = request('/api/ai/claude/?x=%2F&x=2', {
      method: 'POST', body: bytes, headers: {
        Origin: 'https://localhost', 'Content-Type': 'application/octet-stream',
        Authorization: 'Bearer synthetic-provider-key', 'x-google-token': 'synthetic-google-token',
        'x-arty-trial-token': 'synthetic-trial-token',
      },
    })
    const initialHeaders = [...req.headers]
    const { response, api, terminal } = await run(req, async (received) => {
      expect(received).toBe(req)
      expect(received.method).toBe('POST')
      expect(received.url).toBe('https://appfacade.pages.dev/api/ai/claude/?x=%2F&x=2')
      expect([...received.headers]).toEqual(initialHeaders)
      expect(received.bodyUsed).toBe(false)
      expect(new Uint8Array(await received.arrayBuffer())).toEqual(bytes)
      expect(received.bodyUsed).toBe(true)
      return new Response('observed', { status: 202 })
    })
    expect(terminal).toHaveBeenCalledOnce()
    expect(api).toHaveBeenCalledExactlyOnceWith()
    expect(terminal).toHaveBeenCalledExactlyOnceWith()
    expect(response.status).toBe(202)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://localhost')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toBe('observed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the real Calendar authentication gate before parsing or provider dispatch', async () => {
    const req = request('/api/calendar/action', {
      method: 'POST', headers: { Origin: 'https://localhost' }, body: 'not even JSON',
    })
    const { response, terminal } = await run(req, (received) => calendarAction({
      request: received, env: { GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com' } as Env,
    } as never))
    expect(terminal).toHaveBeenCalledOnce()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: 'Authentication required — please sign in with Google',
      calendarOutcome: 'rejected-before-dispatch',
    }))
    expect(req.bodyUsed).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps the real OTP anti-abuse gate before D1/email (Turnstile configured: %s)', async (configured) => {
    const prepare = vi.fn(() => { throw new Error('D1 must not be reached') })
    const env = {
      DB: { prepare }, EMAIL_TRIAL_SECRET: 'synthetic-test-hmac-secret',
      RESEND_API_KEY: 'synthetic-not-a-real-key', EMAIL_FROM: 'Arty <noreply@tryarty.com>',
      ...(configured ? { TURNSTILE_SECRET_KEY: 'synthetic-turnstile-secret' } : {}),
    } as unknown as Env
    const req = request('/api/auth/email/request-otp', {
      method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'transport-test@example.com' }),
    })
    const { response, terminal } = await run(req, (received) => requestOtp({ request: received, env } as never))
    expect(terminal).toHaveBeenCalledOnce()
    expect(response.status).toBe(configured ? 403 : 503)
    expect(await response.json()).toEqual({ error: configured ? 'captcha_failed' : 'email_trial_unavailable' })
    if (!configured) expect(req.bodyUsed).toBe(false)
    expect(prepare).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not relax the Workspace Add-on non-browser gate', async () => {
    const { response, terminal } = await run(request('/api/workspace-addon/phase0/home', {
      method: 'POST', headers: { Origin: 'https://localhost' }, body: '{}',
    }), async () => new Response('unexpected'))
    expect(response.status).toBe(403)
    expect(terminal).not.toHaveBeenCalled()
  })

  it('keeps the existing shared API rate limiter', async () => {
    const results: number[] = []
    let terminalCalls = 0
    for (let count = 0; count < 61; count++) {
      const req = request('/api/transport-test', { headers: { Origin: 'https://localhost' } })
      req.headers.set('cf-connecting-ip', '198.51.100.254')
      const { response } = await run(req, async () => { terminalCalls++; return new Response('ok') })
      results.push(response.status)
    }
    expect(results.slice(0, 60).every((status) => status === 200)).toBe(true)
    expect(results[60]).toBe(429)
    expect(terminalCalls).toBe(60)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe.each([
  { name: 'creem', handler: creemWebhook, header: 'creem-signature', secretName: 'CREEM_WEBHOOK_SECRET', body: '{ "eventType": "transport.test", "note": "é" }\n' },
  { name: 'lemonsqueezy', handler: lemonWebhook, header: 'X-Signature', secretName: 'LEMONSQUEEZY_WEBHOOK_SECRET', body: '{ "meta": { "event_name": "transport.test" }, "note": "é" }\n' },
])('legacy $name webhook through real middleware and HMAC handler', ({ name, handler, header, secretName, body }) => {
  it.each(['valid', 'missing', 'tampered'] as const)('requires the exact signed bytes (%s)', async (signatureCase) => {
    const secret = 'synthetic-webhook-signing-secret'
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const prepare = vi.fn(() => { throw new Error('No DB writes for rejected or unhandled test event') })
    const env = { DB: { prepare }, [secretName]: secret } as unknown as Env
    const req = request(`/api/webhook/${name}`, {
      method: 'POST', body: signatureCase === 'tampered' ? body + ' ' : body,
      headers: signatureCase === 'missing' ? {} : { [header]: signature },
    })
    const { response, terminal } = await run(req, (received) => handler({ request: received, env } as never))
    expect(terminal).toHaveBeenCalledOnce()
    expect(response.status).toBe(signatureCase === 'valid' ? 200 : 401)
    expect(await response.json()).toEqual(signatureCase === 'valid' ? { ok: true } : { error: 'Invalid signature' })
    expect(req.bodyUsed).toBe(true)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(prepare).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
