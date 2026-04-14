import { memo, useEffect, useState } from 'react'
import type { CalendarEvent } from '../../types/google'
import { listEvents } from '../../services/calendarClient'

interface CalendarViewProps {
  days?: number
  onEventClick?: (event: CalendarEvent) => void
}

function formatDateRange(startISO: string, endISO: string): string {
  try {
    const start = new Date(startISO)
    const sameDay = endISO && new Date(endISO).toDateString() === start.toDateString()
    const dateLabel = start.toLocaleDateString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
    const hasTime = startISO.includes('T')
    if (!hasTime) return dateLabel
    const startLabel = start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    if (!endISO) return `${dateLabel} · ${startLabel}`
    const endLabel = new Date(endISO).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    return sameDay
      ? `${dateLabel} · ${startLabel} – ${endLabel}`
      : `${dateLabel} ${startLabel} → ${new Date(endISO).toLocaleDateString('fr-FR')} ${endLabel}`
  } catch {
    return startISO
  }
}

function EventRow({
  event,
  onClick,
}: {
  event: CalendarEvent
  onClick?: (event: CalendarEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(event) : undefined}
      className="w-full text-left bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-accent/20 transition-all p-3 mb-2"
    >
      <p className="text-sm font-medium text-bubble-user truncate">{event.title}</p>
      <p className="text-xs text-gray-400 mt-1">{formatDateRange(event.start, event.end)}</p>
      {event.location && (
        <p className="text-xs text-gray-500 mt-1 truncate">📍 {event.location}</p>
      )}
      {event.description && (
        <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
          {event.description}
        </p>
      )}
    </button>
  )
}

/**
 * Read-only agenda preview. Fetches the next N days of events from Google
 * Calendar via the authenticated proxy and displays them as cards. Purely
 * presentational — mutations happen through the Calendar tools (Claude).
 */
function CalendarViewInner({ days = 7, onEventClick }: CalendarViewProps) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listEvents(days)
      .then((list) => { if (alive) { setEvents(list); setError(null) } })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Erreur agenda')
        setEvents([])
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [days])

  if (loading) {
    return <p className="text-sm text-gray-400 text-center py-4">Chargement de l'agenda…</p>
  }
  if (error) {
    return <p className="text-sm text-red-500 text-center py-4">{error}</p>
  }
  if (!events || events.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">
        Aucun événement dans les {days} prochains jours.
      </p>
    )
  }
  return (
    <div className="flex flex-col">
      {events.map((event) => (
        <EventRow key={event.id} event={event} onClick={onEventClick} />
      ))}
    </div>
  )
}

export const CalendarView = memo(CalendarViewInner)
