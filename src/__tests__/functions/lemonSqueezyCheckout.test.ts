// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'

vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({
  verifyTokenViaTokeninfo: vi.fn(async (token: string) => (
    token === 'valid-google-token' ? 'buyer@example.com' : null
  )),
  notFoundResponse: () => Response.json({ error: 'Not found' }, { status: 404 }),
}))

import { onRequestPost } from '../../../functions/api/checkout/lemonsqueezy'

const configuredEnv = {
  GOOGLE_CLIENT_ID: 'arty-client-id',
  LEMONSQUEEZY_API_KEY: 'ls-test-api-key',
  LEMONSQUEEZY_STORE_ID: '356349',
  LEMONSQUEEZY_SUBSCRIPTION_VARIANT_ID: '1576081',
  LEMONSQUEEZY_PRO_VARIANT_ID: '1576090',
  LEMONSQUEEZY_PREMIUM_PACK_VARIANT_ID: '1576100',
} as unknown as Env

function checkoutRequest(plan: unknown, token = 'valid-google-token'): Request {
  return new Request('https://tryarty.com/api/checkout/lemonsqueezy', {
    method: 'POST',
    headers: {
      Origin: 'https://tryarty.com',
      'Content-Type': 'application/json',
      'x-google-token': token,
    },
    body: JSON.stringify({ plan, email: 'attacker-controlled@example.com' }),
  })
}

describe('POST /api/checkout/lemonsqueezy', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('crée un checkout avec le variant serveur et l’email Google vérifié', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      data: {
        attributes: {
          url: 'https://tryarty.lemonsqueezy.com/checkout/custom/generated-id',
        },
      },
    }))

    const response = await onRequestPost({
      request: checkoutRequest('subscription'),
      env: configuredEnv,
    } as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: 'https://tryarty.lemonsqueezy.com/checkout/custom/generated-id',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [upstreamUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(upstreamUrl).toBe('https://api.lemonsqueezy.com/v1/checkouts')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ls-test-api-key')

    const upstreamBody = JSON.parse(String(init.body))
    expect(upstreamBody).toMatchObject({
      data: {
        attributes: {
          product_options: {
            redirect_url: 'https://tryarty.com/upgrade?checkout=lemonsqueezy',
          },
          checkout_data: {
            email: 'buyer@example.com',
            custom: { app_user_email: 'buyer@example.com' },
          },
        },
        relationships: {
          store: { data: { type: 'stores', id: '356349' } },
          variant: { data: { type: 'variants', id: '1576081' } },
        },
      },
    })
    expect(JSON.stringify(upstreamBody)).not.toContain('attacker-controlled@example.com')
  })

  it('échoue fermée si le token, le plan ou la configuration live est invalide', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    expect((await onRequestPost({
      request: checkoutRequest('subscription', 'invalid-token'),
      env: configuredEnv,
    } as never)).status).toBe(404)
    expect((await onRequestPost({
      request: checkoutRequest('unknown-plan'),
      env: configuredEnv,
    } as never)).status).toBe(404)
    expect((await onRequestPost({
      request: checkoutRequest('pro'),
      env: { ...configuredEnv, LEMONSQUEEZY_PRO_VARIANT_ID: undefined },
    } as never)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuse une URL de redirection fournisseur hors du store Arty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      data: { attributes: { url: 'https://evil.example/checkout/steal' } },
    }))

    const response = await onRequestPost({
      request: checkoutRequest('pro'),
      env: configuredEnv,
    } as never)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Checkout failed' })
  })
})
