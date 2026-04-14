import type { CalendarEvent, CalendarEventDraft } from '../types/google'
import { getValidAccessToken } from './googleAuth'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'

async function calendarFetch(body: Record<string, unknown>): Promise<Response> {
  // Always use getValidAccessToken() so the token is refreshed when close to
  // expiry. Never pass a stored token directly — the proxy rejects expired
  // tokens via checkAllowedUser() (see CLAUDE.md BUG 23).
  const token = await getValidAccessToken()
  if (!token) throw new Error('Non connecté à Google')

  return fetch(apiUrl('/api/calendar/action'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function listEvents(days = 7): Promise<CalendarEvent[]> {
  const res = await calendarFetch({ type: 'list', days })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur agenda')
  return (data.events || []) as CalendarEvent[]
}

export async function createEvent(
  draft: CalendarEventDraft
): Promise<{ id: string; title: string; start: string; link?: string }> {
  const res = await calendarFetch({ type: 'create', ...draft })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur création RDV')
  return data
}

export async function updateEvent(
  eventId: string,
  updates: Partial<CalendarEventDraft>
): Promise<{ success: boolean; title?: string }> {
  const res = await calendarFetch({ type: 'update', eventId, ...updates })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur modification RDV')
  return data
}

export async function deleteEvent(eventId: string): Promise<{ success: boolean }> {
  const res = await calendarFetch({ type: 'delete', eventId })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur suppression RDV')
  return data
}
