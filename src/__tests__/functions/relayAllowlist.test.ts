import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/computer/relay'

// C13 — le relay computer-use ne doit relayer QUE les actions de l'allowlist
// (défense en profondeur), même après une auth owner valide.
const OWNER = 'owner-sub-123'
const env = {
  GOOGLE_CLIENT_ID: 'arty-client-id',
  COMPUTER_RELAY_ENABLED: 'true',
  COMPUTER_RELAY_OWNER_SUB: OWNER,
  TUNNEL_URL: 'https://tunnel.test',
  TUNNEL_SECRET: 'secret',
} as unknown

function req(action: string): Request {
  return new Request('https://tryarty.com/api/computer/relay', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-google-token': 'tok' },
    body: JSON.stringify({ action, params: {} }),
  })
}

function stubFetch() {
  const spy = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes('/tokeninfo')) return new Response(JSON.stringify({ aud: 'arty-client-id' }), { status: 200 })
    if (u.includes('/oauth2/v2/userinfo')) {
      return new Response(JSON.stringify({ id: OWNER, email: 'owner@example.com', verified_email: true }), { status: 200 })
    }
    if (u.includes('/health')) return new Response('{}', { status: 200 })
    if (u.includes('/computer/action')) return new Response(JSON.stringify({ success: true }), { status: 200 })
    throw new Error('unexpected fetch ' + u)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}
afterEach(() => vi.unstubAllGlobals())

const call = (r: Request) => onRequestPost({ request: r, env } as never)

describe('computer/relay — allowlist (C13)', () => {
  it('REJETTE une action hors allowlist (400) sans toucher au tunnel', async () => {
    const spy = stubFetch()
    const res = await call(req('rm_rf'))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('Unknown action')
    expect(spy.mock.calls.some((c) => String(c[0]).includes('/computer/action'))).toBe(false)
  })

  it("ACCEPTE une action de l'allowlist (relayée au tunnel)", async () => {
    const spy = stubFetch()
    const res = await call(req('screenshot'))
    expect(res.status).toBe(200)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('/computer/action'))).toBe(true)
  })
})
