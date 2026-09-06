import type { Env } from '../../env'
import {
  strictGoogleIdentityFailureResponse,
  verifyGoogleIdentityStrictDetailed,
} from '../_lib/checkAllowedUser'
import { googleFetch } from '../_lib/googleFetch'
import { validatePublicGoogleScopeClaim } from '../_lib/publicGoogleScopes'
import { CALENDAR_PROTOCOL, calendarMutationPayload } from '../../../src/utils/calendarProtocol'

const ID_RE = /^[a-zA-Z0-9_@.+\-=]+$/
const rejected = (error: string, status = 400) => Response.json({ error, calendarProtocol: CALENDAR_PROTOCOL, calendarOutcome: 'rejected-before-dispatch' }, { status })

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const identity = await verifyGoogleIdentityStrictDetailed(request, env.GOOGLE_CLIENT_ID)
  if (identity.status !== 'ok') {
    const response = strictGoogleIdentityFailureResponse(identity)
    const data = await response.json() as { error: string }
    return rejected(data.error, response.status)
  }

  const token = request.headers.get('x-google-token')?.trim() || ''
  const scopeCheck = validatePublicGoogleScopeClaim(identity.identity.scope)
  if (!scopeCheck.ok) {
    return rejected(scopeCheck.reason === 'scope_mismatch' ? 'Google reconsent required' : 'Google authentication temporarily unavailable', scopeCheck.reason === 'scope_mismatch' ? 403 : 503)
  }

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rejected('Invalid request')
    body = parsed as Record<string, unknown>
    if (body.calendarProtocol !== undefined) {
      if (body.calendarProtocol !== CALENDAR_PROTOCOL) return rejected('Unsupported Calendar protocol')
      if (body.calendarAccount !== identity.identity.email.trim().toLowerCase()) return rejected('Calendar account changed', 409)
      if (body.type === 'list') {
        if (!Number.isInteger(body.days) || (body.days as number) < 1 || (body.days as number) > 366) return rejected('Invalid days')
      } else if (body.type === 'create' || body.type === 'update' || body.type === 'delete') {
        body = calendarMutationPayload(body.type, body, body.eventId as string)
      } else return rejected('Invalid operation')
    }
  } catch { return rejected('Invalid Calendar request') }
  const type = body.type as string | undefined

  switch (type) {
    case 'list': return handleList(token, body)
    case 'create': return handleCreate(token, body)
    case 'update': return handleUpdate(token, body)
    case 'delete': return handleDelete(token, body)
    default: return rejected('Use type: list, create, update, delete')
  }
}

async function handleList(token: string, body: Record<string, unknown>): Promise<Response> {
  const days = (body.days as number) || 7
  const now = new Date()
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  try {
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '20',
    })

    const r = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) return Response.json({ error: 'Calendar operation failed' }, { status: r.status })

    const data = await r.json() as { items?: Array<Record<string, unknown>> }
    const events = (data.items || []).map((e) => ({
      id: e.id,
      title: (e.summary as string) || '(sans titre)',
      start: (e.start as Record<string, string>)?.dateTime || (e.start as Record<string, string>)?.date || '',
      end: (e.end as Record<string, string>)?.dateTime || (e.end as Record<string, string>)?.date || '',
      location: (e.location as string) || '',
      description: (e.description as string) || '',
      htmlLink: (e.htmlLink as string) || undefined,
    }))
    return Response.json({ events })
  } catch {
    return Response.json({ error: 'Failed to list events' }, { status: 500 })
  }
}

async function handleCreate(token: string, body: Record<string, unknown>): Promise<Response> {
  const { title, start, end, location, description } = body as {
    title?: string; start?: string; end?: string; location?: string; description?: string
  }
  if (typeof title !== 'string' || !title || typeof start !== 'string' || !start) return rejected('Missing title or start')

  try {
    const event: Record<string, unknown> = {
      summary: title,
      start: start.includes('T') ? { dateTime: start, timeZone: 'Europe/Paris' } : { date: start },
      end: end
        ? (end.includes('T') ? { dateTime: end, timeZone: 'Europe/Paris' } : { date: end })
        : start.includes('T')
          ? { dateTime: new Date(new Date(start).getTime() + 3600000).toISOString(), timeZone: 'Europe/Paris' }
          : { date: start },
    }
    if (location) event.location = location
    if (description) event.description = description

    const r = await googleFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    if (!r.ok) return Response.json({ error: 'Calendar operation failed' }, { status: r.status })

    const result = await r.json() as Record<string, unknown>
    return Response.json({
      id: result.id,
      title: result.summary,
      start: (result.start as Record<string, string>)?.dateTime || (result.start as Record<string, string>)?.date,
      link: result.htmlLink,
    })
  } catch {
    return Response.json({ error: 'Failed to create event' }, { status: 500 })
  }
}

async function handleUpdate(token: string, body: Record<string, unknown>): Promise<Response> {
  const { eventId, title, start, end, location, description } = body as {
    eventId?: string; title?: string; start?: string; end?: string; location?: string; description?: string
  }
  if (typeof eventId !== 'string' || !eventId) return rejected('Missing eventId')
  // BUG 32 — valider eventId pour éviter l'injection dans l'URL Google API.
  if (!ID_RE.test(eventId)) return rejected('Invalid eventId')

  try {
    const update: Record<string, unknown> = {}
    if (title) update.summary = title
    if (start) update.start = start.includes('T') ? { dateTime: start, timeZone: 'Europe/Paris' } : { date: start }
    if (end) update.end = end.includes('T') ? { dateTime: end, timeZone: 'Europe/Paris' } : { date: end }
    if (location || (body.calendarProtocol === CALENDAR_PROTOCOL && location === '')) update.location = location
    if (description || (body.calendarProtocol === CALENDAR_PROTOCOL && description === '')) update.description = description

    const r = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(update) }
    )
    if (!r.ok) return Response.json({ error: 'Calendar operation failed' }, { status: r.status })
    const result = await r.json() as Record<string, unknown>
    return Response.json({ success: true, title: result.summary })
  } catch { return Response.json({ error: 'Update failed' }, { status: 500 }) }
}

async function handleDelete(token: string, body: Record<string, unknown>): Promise<Response> {
  const eventId = body.eventId as string
  if (typeof eventId !== 'string' || !eventId) return rejected('Missing eventId')
  // BUG 32 — valider eventId pour éviter l'injection dans l'URL Google API.
  if (!ID_RE.test(eventId)) return rejected('Invalid eventId')

  try {
    const r = await googleFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok && r.status !== 204) return Response.json({ error: 'Delete failed' }, { status: r.status })
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Delete failed' }, { status: 500 }) }
}
