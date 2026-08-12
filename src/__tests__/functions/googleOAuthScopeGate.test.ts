import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { CURRENT_GOOGLE_OAUTH_PROFILE } from '../../../functions/api/_lib/publicGoogleScopes'
import { onRequestPost as exchangeToken } from '../../../functions/api/auth/token'
import { onRequestPost as refreshToken } from '../../../functions/api/auth/refresh'

const ENV = {
  GOOGLE_CLIENT_ID: 'public-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'server-secret',
} as Env

const CURRENT_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events.owned',
].join(' ')

const PREVIOUS_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')

function request(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://tryarty.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function stubGoogle(scopes: string | null) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      })
    }
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
      return Response.json(scopes === null ? {} : { scope: scopes })
    }
    if (url === 'https://oauth2.googleapis.com/revoke') {
      return new Response(null, { status: 200 })
    }
    throw new Error(`URL Google inattendue: ${url}`)
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('OAuth Google — ensemble public unique calendar.events.owned', () => {
  it('accepte l’échange du profil courant avec son ensemble exact', async () => {
    stubGoogle(CURRENT_SCOPES)
    const response = await exchangeToken({
      request: request('/api/auth/token', {
        code: 'code',
        redirect_uri: 'https://tryarty.com/auth/callback',
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
      }),
      env: ENV,
    } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      access_token: 'fresh-access',
      oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
    }))
  })

  it('accepte le refresh du profil courant avec son ensemble exact', async () => {
    stubGoogle(CURRENT_SCOPES)
    const response = await refreshToken({
      request: request('/api/auth/refresh', {
        refresh_token: 'stored-refresh',
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
      }),
      env: ENV,
    } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      access_token: 'fresh-access',
      oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
    }))
  })

  it.each([
    ['calendar-events-v1', 'https://tryarty.com/auth/callback'],
    ['legacy-calendar-v1', ''],
    [undefined, ''],
  ])('refuse l’ancien profil %s avant tout échange Google', async (oauthProfile, redirectUri) => {
    const fetchMock = stubGoogle(PREVIOUS_SCOPES)
    const response = await exchangeToken({
      request: request('/api/auth/token', {
        code: 'old-code',
        redirect_uri: redirectUri,
        oauth_profile: oauthProfile,
      }),
      env: ENV,
    } as never)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'unsupported_oauth_profile' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['calendar-events-v1', 'legacy-calendar-v1', undefined])(
    'refuse le refresh de l’ancien profil %s avant tout appel Google',
    async (oauthProfile) => {
      const fetchMock = stubGoogle(PREVIOUS_SCOPES)
      const response = await refreshToken({
        request: request('/api/auth/refresh', {
          refresh_token: 'old-refresh',
          oauth_profile: oauthProfile,
        }),
        env: ENV,
      } as never)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'unsupported_oauth_profile' })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    PREVIOUS_SCOPES,
    `${CURRENT_SCOPES} https://www.googleapis.com/auth/calendar`,
    `${CURRENT_SCOPES} https://www.googleapis.com/auth/gmail.readonly`,
    `${CURRENT_SCOPES} https://www.googleapis.com/auth/drive`,
    `${CURRENT_SCOPES} https://www.googleapis.com/auth/contacts`,
  ])('rejette et révoque tout ensemble différent ou surnuméraire : %s', async (scopes) => {
    const fetchMock = stubGoogle(scopes)
    const response = await exchangeToken({
      request: request('/api/auth/token', {
        code: 'code',
        redirect_uri: 'https://tryarty.com/auth/callback',
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
      }),
      env: ENV,
    } as never)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'invalid_scope_set' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('échoue fermé sans révoquer si tokeninfo ne fournit pas les scopes', async () => {
    const fetchMock = stubGoogle(null)
    const response = await exchangeToken({
      request: request('/api/auth/token', {
        code: 'code',
        redirect_uri: 'https://tryarty.com/auth/callback',
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
      }),
      env: ENV,
    } as never)

    expect(response.status).toBe(502)
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.anything(),
    )
  })

  it('échoue fermé sans révoquer lors d’une indisponibilité tokeninfo', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600 })
      }
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
        return new Response(null, { status: 503 })
      }
      if (url === 'https://oauth2.googleapis.com/revoke') return new Response(null, { status: 200 })
      throw new Error(`URL Google inattendue: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const response = await exchangeToken({
      request: request('/api/auth/token', {
        code: 'code',
        redirect_uri: 'https://tryarty.com/auth/callback',
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
      }),
      env: ENV,
    } as never)

    expect(response.status).toBe(502)
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.anything(),
    )
  })

  it('accepte les alias standards email/profile du flux Android courant', async () => {
    stubGoogle('openid email profile https://www.googleapis.com/auth/calendar.events.owned')
    const response = await refreshToken({
      request: request('/api/auth/refresh', {
        refresh_token: 'stored-refresh',
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
      }),
      env: ENV,
    } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
    }))
  })
})
