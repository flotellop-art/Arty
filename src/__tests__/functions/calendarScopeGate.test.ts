import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { onRequestPost } from '../../../functions/api/calendar/action'

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

function calendarRequest(includeToken = true): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (includeToken) {
    headers.set('authorization', 'Bearer current-access')
    headers.set('x-google-token', 'current-access')
  }
  return new Request('https://tryarty.com/api/calendar/action', {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'list', days: 7 }),
  })
}

function tokenInfo(scopes: string) {
  return {
    email: 'reviewer@example.com',
    email_verified: true,
    aud: ENV.GOOGLE_CLIENT_ID,
    sub: 'google-sub',
    scope: scopes,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('/api/calendar/action — profil OAuth public exact', () => {
  it('autorise le profil calendar.events.owned puis relaie vers le calendrier principal', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
        return Response.json(tokenInfo(CURRENT_SCOPES))
      }
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')) {
        return Response.json({ items: [{
          id: 'source-event',
          summary: 'Source event',
          start: { dateTime: '2026-08-13T09:00:00+02:00' },
          end: { dateTime: '2026-08-13T09:30:00+02:00' },
          htmlLink: 'https://calendar.google.com/event?eid=source',
        }] })
      }
      throw new Error(`URL inattendue: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const response = await onRequestPost({ request: calendarRequest(), env: ENV } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ events: [{
      id: 'source-event',
      title: 'Source event',
      start: '2026-08-13T09:00:00+02:00',
      end: '2026-08-13T09:30:00+02:00',
      location: '',
      description: '',
      htmlLink: 'https://calendar.google.com/event?eid=source',
    }] })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/tokeninfo?'))).toHaveLength(1)
  })

  it('refuse immédiatement un ancien access token calendar.events avant Google Calendar', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
        return Response.json(tokenInfo(PREVIOUS_SCOPES))
      }
      throw new Error(`Le relais Calendar ne devait pas être appelé: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const response = await onRequestPost({ request: calendarRequest(), env: ENV } as never)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Google reconsent required' })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/calendar/v3/'))).toBe(false)
  })

  it('refuse sans token avant tout appel réseau', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const response = await onRequestPost({ request: calendarRequest(false), env: ENV } as never)

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('échoue fermé si le client OAuth serveur est absent', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const response = await onRequestPost({
      request: calendarRequest(),
      env: { ...ENV, GOOGLE_CLIENT_ID: '' },
    } as never)

    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ne relaie pas l’opération quand le contrôle tokeninfo est indisponible', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
        return new Response(null, { status: 503 })
      }
      throw new Error(`Le relais Calendar ne devait pas être appelé: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const response = await onRequestPost({ request: calendarRequest(), env: ENV } as never)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Authentication service temporarily unavailable' })
  })
})
