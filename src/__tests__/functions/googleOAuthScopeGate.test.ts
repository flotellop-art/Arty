import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import {
  CURRENT_GOOGLE_OAUTH_PROFILE,
  isLegacyGoogleOAuthCompatActive,
} from '../../../functions/api/_lib/publicGoogleScopes'
import { onRequestPost as exchangeToken } from '../../../functions/api/auth/token'
import { onRequestPost as refreshToken } from '../../../functions/api/auth/refresh'

const ENV = {
  GOOGLE_CLIENT_ID: 'public-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'server-secret',
} as Env
const COMPAT_ENV = {
  ...ENV,
  GOOGLE_OAUTH_LEGACY_COMPAT_UNTIL: '2026-07-21T23:59:59Z',
} as Env

const CURRENT_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')
const LEGACY_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
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
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-14T12:00:00Z'))
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OAuth Google — profils de scopes réellement émis', () => {
  it('accepte le profil calendar.events annoncé par le nouveau client', async () => {
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

  it('accepte temporairement le profil calendar exact de l’ancien APK natif', async () => {
    stubGoogle(LEGACY_SCOPES)

    const response = await exchangeToken({
      request: request('/api/auth/token', { code: 'old-apk-code', redirect_uri: '' }),
      env: COMPAT_ENV,
    } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      oauth_profile: 'legacy-calendar-v1',
    }))
  })

  it('refuse le profil legacy sur un échange web même pendant la fenêtre', async () => {
    const fetchMock = stubGoogle(LEGACY_SCOPES)
    const response = await exchangeToken({
      request: request('/api/auth/token', {
        code: 'old-web-code',
        redirect_uri: 'https://tryarty.com/auth/callback',
      }),
      env: COMPAT_ENV,
    } as never)

    expect(response.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('accepte temporairement le refresh exact de l’ancien APK', async () => {
    stubGoogle(LEGACY_SCOPES)
    const response = await refreshToken({
      request: request('/api/auth/refresh', { refresh_token: 'stored-refresh' }),
      env: COMPAT_ENV,
    } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      oauth_profile: 'legacy-calendar-v1',
    }))
  })

  it.each([
    ['compat absente', ENV],
    ['compat invalide', { ...ENV, GOOGLE_OAUTH_LEGACY_COMPAT_UNTIL: 'not-a-date' } as Env],
    ['compat expirée', { ...ENV, GOOGLE_OAUTH_LEGACY_COMPAT_UNTIL: '2026-07-13T23:59:59Z' } as Env],
    ['compat au-delà du maximum codé', { ...ENV, GOOGLE_OAUTH_LEGACY_COMPAT_UNTIL: '2026-12-31T23:59:59Z' } as Env],
  ])('rejette et révoque le refresh legacy si %s', async (_label, env) => {
    const fetchMock = stubGoogle(LEGACY_SCOPES)
    const response = await refreshToken({
      request: request('/api/auth/refresh', { refresh_token: 'stored-refresh' }),
      env,
    } as never)

    expect(response.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('borne le cutoff de compatibilité côté code', () => {
    expect(isLegacyGoogleOAuthCompatActive(undefined)).toBe(false)
    expect(isLegacyGoogleOAuthCompatActive('not-a-date')).toBe(false)
    expect(isLegacyGoogleOAuthCompatActive('2026-07-21T23:59:59Z')).toBe(true)
    expect(isLegacyGoogleOAuthCompatActive('2026-07-22T00:00:00Z')).toBe(false)
  })

  it.each([
    `${CURRENT_SCOPES} https://www.googleapis.com/auth/calendar`,
    `${CURRENT_SCOPES} https://www.googleapis.com/auth/gmail.readonly`,
    `${LEGACY_SCOPES} https://www.googleapis.com/auth/drive`,
    `${CURRENT_SCOPES} https://www.googleapis.com/auth/contacts`,
  ])('rejette et révoque tout mélange ou scope surnuméraire : %s', async (scopes) => {
    const fetchMock = stubGoogle(scopes)
    const response = await exchangeToken({
      request: request('/api/auth/token', {
        code: 'code',
        redirect_uri: '',
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
      }),
      env: COMPAT_ENV,
    } as never)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'invalid_scope_set' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('échoue fermé si tokeninfo ne fournit pas les scopes', async () => {
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
    stubGoogle('openid email profile https://www.googleapis.com/auth/calendar.events')
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
