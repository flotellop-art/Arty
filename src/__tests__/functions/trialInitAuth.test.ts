import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/trial/init'

const ORIGINAL_FETCH = global.fetch
const ENV = {
  GOOGLE_CLIENT_ID: 'arty-client-id',
  ALLOWED_EMAILS: 'vip@example.com',
}

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

function call(env: Record<string, unknown> = ENV) {
  return onRequestPost({
    request: new Request('https://tryarty.com/api/trial/init', {
      method: 'POST',
      headers: { Authorization: 'Bearer google-token' },
    }),
    env,
  } as never) as Promise<Response>
}

describe('trial/init — vérification Google partagée et fail-closed', () => {
  it('refuse une configuration sans GOOGLE_CLIENT_ID sans contacter Google', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as typeof fetch

    const response = await call({ ...ENV, GOOGLE_CLIENT_ID: '' })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'authentication_unavailable' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([429, 500, 503])('classe un tokeninfo HTTP %s comme indisponible', async (status) => {
    global.fetch = vi.fn(async () => new Response('', { status })) as typeof fetch

    const response = await call()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'authentication_unavailable' })
  })

  it('refuse une audience étrangère', async () => {
    global.fetch = vi.fn(async () => Response.json({
      email: 'vip@example.com',
      email_verified: true,
      aud: 'another-client',
    })) as typeof fetch

    const response = await call()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
  })

  it('retourne VIP avec le même contrat tokeninfo que subscription/status', async () => {
    const fetchSpy = vi.fn(async () => Response.json({
      email: 'VIP@Example.com',
      email_verified: 'true',
      aud: 'arty-client-id',
      sub: 'google-sub',
    }))
    global.fetch = fetchSpy as typeof fetch

    const response = await call()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ plan: 'vip' })
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})
