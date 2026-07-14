import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cancel = vi.fn()

vi.mock('../../services/googleAuth', () => ({
  CURRENT_GOOGLE_OAUTH_PROFILE: 'calendar-events-v1',
  withTimeout: () => ({ signal: new AbortController().signal, cancel }),
}))

import { exchangeNativeGoogleCode } from '../../services/nativeGoogleTokenExchange'

describe('exchangeNativeGoogleCode', () => {
  beforeEach(() => {
    cancel.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuse de créer des credentials sans code natif', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeNativeGoogleCode('')).rejects.toThrow(/authorization code/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuse une réponse OAuth 200 dépourvue de access_token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ oauth_profile: 'calendar-events-v1', refresh_token: 'refresh', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ))

    await expect(exchangeNativeGoogleCode('one-time-code')).rejects.toThrow(/no access token/i)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('refuse une réponse classée avec le profil Calendar legacy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        oauth_profile: 'legacy-calendar-v1',
        access_token: 'legacy-access',
        refresh_token: 'legacy-refresh',
        expires_in: 3600,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    ))

    await expect(exchangeNativeGoogleCode('one-time-code')).rejects.toThrow(/profile/i)
  })

  it('échange le code natif avec redirect_uri vide et renvoie des tokens validés', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ oauth_profile: 'calendar-events-v1', access_token: ' access ', refresh_token: 'refresh', expires_in: 7200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeNativeGoogleCode('one-time-code')).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 7200,
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      code: 'one-time-code',
      redirect_uri: '',
      oauth_profile: 'calendar-events-v1',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
