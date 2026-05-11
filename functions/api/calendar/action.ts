import { verifyGoogleUser, notFoundResponse } from '../_lib/checkAllowedUser'

const ID_RE = /^[a-zA-Z0-9_@.+\-=]+$/

export const onRequestPost: PagesFunction = async ({ request }) => {
  // CRIT-4 (audit étape 2) — exiger un user Google identifié pour éviter
  // le proxy ouvert Google API (un token Google volé ne suffit plus).
  const email = await verifyGoogleUser(request)
  if (!email) return notFoundResponse()

  const token = request.headers.get('authorization')?.replace('Bearer ', '') || ''
  if (!token) return notFoundResponse()

  const body = await request.json() as Record<string, unknown>
  const type = body.type as string | undefined

  switch (type) {
    case 'list': return handleList(token, body)
    case 'create': return handleCreate(token, body)
    case 'update': return handleUpdate(token, body)
    case 'delete': return handleDelete(token, body)
    default: return Response.json({ error: 'Use type: list, create, update, delete' }, { status: 400 })
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

    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }

    const data = await r.json() as { items?: Array<Record<string, unknown>> }
    const events = (data.items || []).map((e) => ({
      id: e.id,
      title: (e.summary as string) || '(sans titre)',
      start: (e.start as Record<string, string>)?.dateTime || (e.start as Record<string, string>)?.date || '',
      end: (e.end as Record<string, string>)?.dateTime || (e.end as Record<string, string>)?.date || '',
      location: (e.location as string) || '',
      description: (e.description as string) || '',
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
  if (!title || !start) return Response.json({ error: 'Missing title or start' }, { status: 400 })

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

    const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }

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
  if (!eventId) return Response.json({ error: 'Missing eventId' }, { status: 400 })
  // BUG 32 — valider eventId pour éviter l'injection dans l'URL Google API.
  if (!ID_RE.test(eventId)) return Response.json({ error: 'Invalid eventId' }, { status: 400 })

  try {
    const update: Record<string, unknown> = {}
    if (title) update.summary = title
    if (start) update.start = start.includes('T') ? { dateTime: start, timeZone: 'Europe/Paris' } : { date: start }
    if (end) update.end = end.includes('T') ? { dateTime: end, timeZone: 'Europe/Paris' } : { date: end }
    if (location) update.location = location
    if (description) update.description = description

    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(update) }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    const result = await r.json() as Record<string, unknown>
    return Response.json({ success: true, title: result.summary })
  } catch { return Response.json({ error: 'Update failed' }, { status: 500 }) }
}

async function handleDelete(token: string, body: Record<string, unknown>): Promise<Response> {
  const eventId = body.eventId as string
  if (!eventId) return Response.json({ error: 'Missing eventId' }, { status: 400 })
  // BUG 32 — valider eventId pour éviter l'injection dans l'URL Google API.
  if (!ID_RE.test(eventId)) return Response.json({ error: 'Invalid eventId' }, { status: 400 })

  try {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok && r.status !== 204) return Response.json({ error: 'Delete failed' }, { status: r.status })
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Delete failed' }, { status: 500 }) }
}
