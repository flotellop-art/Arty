import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing access token' })

  const { type } = req.body as { type?: string }

  switch (type) {
    case 'list': return handleList(token, req, res)
    case 'create': return handleCreate(token, req, res)
    case 'update': return handleUpdate(token, req, res)
    case 'delete': return handleDeleteEvent(token, req, res)
    default: return res.status(400).json({ error: 'Use type: list or create' })
  }
}

async function handleList(token: string, req: VercelRequest, res: VercelResponse) {
  const { days } = req.body as { days?: number }
  const now = new Date()
  const end = new Date(now.getTime() + (days || 7) * 24 * 60 * 60 * 1000)

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

    if (!r.ok) {
      const err = await r.json()
      return res.status(r.status).json({ error: err.error?.message })
    }

    const data = await r.json()
    const events = (data.items || []).map((e: {
      id: string
      summary?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      location?: string
      description?: string
    }) => ({
      id: e.id,
      title: e.summary || '(sans titre)',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
      location: e.location || '',
      description: e.description || '',
    }))

    return res.status(200).json({ events })
  } catch {
    return res.status(500).json({ error: 'Failed to list events' })
  }
}

async function handleCreate(token: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })

  const { title, start, end, location, description } = req.body as {
    title?: string; start?: string; end?: string; location?: string; description?: string
  }

  if (!title || !start) return res.status(400).json({ error: 'Missing title or start' })

  try {
    const event: Record<string, unknown> = {
      summary: title,
      start: start.includes('T')
        ? { dateTime: start, timeZone: 'Europe/Paris' }
        : { date: start },
      end: end
        ? (end.includes('T') ? { dateTime: end, timeZone: 'Europe/Paris' } : { date: end })
        : start.includes('T')
          ? { dateTime: new Date(new Date(start).getTime() + 3600000).toISOString(), timeZone: 'Europe/Paris' }
          : { date: start },
    }
    if (location) event.location = location
    if (description) event.description = description

    const r = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }
    )

    if (!r.ok) {
      const err = await r.json()
      return res.status(r.status).json({ error: err.error?.message })
    }

    const result = await r.json()
    return res.status(200).json({
      id: result.id,
      title: result.summary,
      start: result.start?.dateTime || result.start?.date,
      link: result.htmlLink,
    })
  } catch {
    return res.status(500).json({ error: 'Failed to create event' })
  }
}

async function handleUpdate(token: string, req: VercelRequest, res: VercelResponse) {
  const { eventId, title, start, end, location, description } = req.body as {
    eventId?: string; title?: string; start?: string; end?: string; location?: string; description?: string
  }
  if (!eventId) return res.status(400).json({ error: 'Missing eventId' })
  try {
    const update: Record<string, unknown> = {}
    if (title) update.summary = title
    if (start) update.start = start.includes('T') ? { dateTime: start, timeZone: 'Europe/Paris' } : { date: start }
    if (end) update.end = end.includes('T') ? { dateTime: end, timeZone: 'Europe/Paris' } : { date: end }
    if (location) update.location = location
    if (description) update.description = description

    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      }
    )
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const result = await r.json()
    return res.status(200).json({ success: true, title: result.summary })
  } catch { return res.status(500).json({ error: 'Update failed' }) }
}

async function handleDeleteEvent(token: string, req: VercelRequest, res: VercelResponse) {
  const { eventId } = req.body as { eventId?: string }
  if (!eventId) return res.status(400).json({ error: 'Missing eventId' })
  try {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok && r.status !== 204) { const err = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (err as {error?: {message?: string}}).error?.message || 'Delete failed' }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Delete failed' }) }
}
