import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { onRequestPost as exchangeToken } from '../../../functions/api/auth/token'
import { onRequestPost as refreshToken } from '../../../functions/api/auth/refresh'

const ENV = {
  GOOGLE_CLIENT_ID: 'public-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'server-secret',
} as Env

const VALID_SCOPES = [
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
  vi.restoreAllMocks()
})

describe('OAuth Google — allowlist des scopes réellement émis', () => {
  it('accepte exactement le profil public', async () => {
    stubGoogle(VALID_SCOPES)

    const response = await exchangeToken({
      request: request('/api/auth/token', { code: 'code', redirect_uri: 'https://tryarty.com/auth/callback' }),
      env: ENV,
    } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ access_token: 'fresh-access' }))
  })

  it.each([
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/contacts',
  ])('rejette et révoque un scope surnuméraire : %s', async (extraScope) => {
    const fetchMock = stubGoogle(`${VALID_SCOPES} ${extraScope}`)

    const response = await exchangeToken({
      request: request('/api/auth/token', { code: 'code', redirect_uri: 'https://tryarty.com/auth/callback' }),
      env: ENV,
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
      request: request('/api/auth/token', { code: 'code', redirect_uri: 'https://tryarty.com/auth/callback' }),
      env: ENV,
    } as never)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'invalid_scope_set' })
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.anything(),
    )
  })

  it('échoue fermé sans révoquer lors d\'une indisponibilité tokeninfo', async () => {
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
        return new Response(null, { status: 503 })
      }
      if (url === 'https://oauth2.googleapis.com/revoke') {
        return new Response(null, { status: 200 })
      }
      throw new Error(`URL Google inattendue: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const response = await exchangeToken({
      request: request('/api/auth/token', { code: 'code', redirect_uri: 'https://tryarty.com/auth/callback' }),
      env: ENV,
    } as never)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'invalid_scope_set' })
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.anything(),
    )
  })

  it('applique la même allowlist lors du renouvellement', async () => {
    stubGoogle(`${VALID_SCOPES} https://www.googleapis.com/auth/gmail.modify`)

    const response = await refreshToken({
      request: request('/api/auth/refresh', { refresh_token: 'stored-refresh' }),
      env: ENV,
    } as never)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'invalid_scope_set' })
  })

  it('accepte les alias standards email/profile du flux Android', async () => {
    stubGoogle('openid email profile https://www.googleapis.com/auth/calendar')

    const response = await refreshToken({
      request: request('/api/auth/refresh', { refresh_token: 'stored-refresh' }),
      env: ENV,
    } as never)

    expect(response.status).toBe(200)
  })
})
