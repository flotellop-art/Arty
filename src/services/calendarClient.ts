import type { CalendarEvent, CalendarEventDraft } from '../types/google'
import { getValidAccessToken } from './googleAuth'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'

// Miroir du googleFetch serveur (C13, PR #314 : 20 s vers googleapis). Sans
// borne, un appel outil pendu gelait la boucle d'outils LLM — spinner sans fin
// côté chat (même classe que BUG 47). Le timer couvre le fetch ET la lecture
// du body : c'est pour ça que calendarFetch parse le JSON lui-même au lieu de
// rendre la Response (un body lu hors timer resterait non borné).
const CALENDAR_TIMEOUT_MS = 20_000

async function calendarFetch(
  body: Record<string, unknown>
): Promise<{ res: Response; data: Record<string, any> }> {
  // Always use getValidAccessToken() so the token is refreshed when close to
  // expiry. Never pass a stored token directly — the proxy rejects expired
  // tokens via checkAllowedUser() (see CLAUDE.md BUG 23).
  const token = await getValidAccessToken()
  if (!token) throw new Error('Non connecté à Google')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'AbortError')), CALENDAR_TIMEOUT_MS)
  try {
    const res = await fetch(apiUrl('/api/calendar/action'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await safeJson(res)
    return { res, data }
  } catch (err) {
    // Message actionnable pour le tool_result LLM (les handlers surfacent
    // err.message) au lieu du « Timeout » brut du DOMException.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Google Calendar n\'a pas répondu (délai dépassé). Réessaie dans un instant.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function listEvents(days = 7): Promise<CalendarEvent[]> {
  const { res, data } = await calendarFetch({ type: 'list', days })
  if (!res.ok) throw new Error(data.error || 'Erreur agenda')
  return (data.events || []).map((e: any) => ({
    id: e.id,
    title: e.title || e.summary || '',
    start: e.start,
    end: e.end,
    location: e.location || '',
    description: e.description || '',
    htmlLink: e.htmlLink,
  })) as CalendarEvent[]
}

export async function createEvent(
  draft: CalendarEventDraft
): Promise<{ id: string; title: string; start: string; link?: string }> {
  const { res, data } = await calendarFetch({ type: 'create', ...draft })
  if (!res.ok) throw new Error(data.error || 'Erreur création RDV')
  return data as { id: string; title: string; start: string; link?: string }
}

export async function updateEvent(
  eventId: string,
  updates: Partial<CalendarEventDraft>
): Promise<{ success: boolean; title?: string }> {
  const { res, data } = await calendarFetch({ type: 'update', eventId, ...updates })
  if (!res.ok) throw new Error(data.error || 'Erreur modification RDV')
  return data as { success: boolean; title?: string }
}

export async function deleteEvent(eventId: string): Promise<{ success: boolean }> {
  const { res, data } = await calendarFetch({ type: 'delete', eventId })
  if (!res.ok) throw new Error(data.error || 'Erreur suppression RDV')
  return data as { success: boolean }
}
