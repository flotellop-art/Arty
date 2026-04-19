import { memo, useEffect, useState } from 'react'
import type { CalendarEvent } from '../../types/google'
import { listEvents } from '../../services/calendarClient'
import { DotLine } from '../shared/editorial'

interface CalendarViewProps {
  days?: number
  onEventClick?: (event: CalendarEvent) => void
}

function formatTime(startISO: string): string {
  try {
    const hasTime = startISO.includes('T')
    if (!hasTime) return '—'
    return new Date(startISO).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return startISO
  }
}

function formatDay(startISO: string): string {
  try {
    const d = new Date(startISO)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    const tomorrow = new Date(now.getTime() + 86400000)
    if (sameDay) return "Aujourd'hui"
    if (d.toDateString() === tomorrow.toDateString()) return 'Demain'
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

function EventRow({
  event,
  onClick,
  last,
}: {
  event: CalendarEvent
  onClick?: (event: CalendarEvent) => void
  last: boolean
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClick ? () => onClick(event) : undefined}
        className="w-full text-left py-3 transition-opacity hover:opacity-80"
      >
        <div className="flex gap-3 items-baseline">
          <span
            className="font-mono text-[11px] w-14 shrink-0 font-bold"
            style={{ color: 'var(--arty-accent)' }}
          >
            {formatTime(event.start)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-serif text-[14px] leading-[1.25] truncate" style={{ color: 'var(--arty-ink)' }}>
              {event.title}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--arty-muted)' }}>
              <span className="font-sans uppercase tracking-wider">{formatDay(event.start)}</span>
              {event.location && <span className="font-serif italic ml-2">· {event.location}</span>}
            </p>
          </div>
        </div>
      </button>
      {!last && <DotLine />}
    </>
  )
}

/**
 * Aperçu lecture seule de l'agenda. Récupère les N prochains jours via
 * le proxy Calendar. Les mutations passent par les outils Claude.
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
    return <p className="font-serif italic text-[13px] text-center py-4" style={{ color: 'var(--arty-muted)' }}>Lecture de l'agenda…</p>
  }
  if (error) {
    return (
      <p
        className="text-[13px] font-serif italic px-3 py-2"
        style={{
          color: 'var(--arty-accent)',
          backgroundColor: 'var(--arty-accent-glow)',
          borderLeft: '2px solid var(--arty-accent)',
          borderRadius: 2,
        }}
      >
        {error}
      </p>
    )
  }
  if (!events || events.length === 0) {
    return (
      <p className="font-serif italic text-[13px] text-center py-4" style={{ color: 'var(--arty-muted)' }}>
        Aucun événement dans les {days} prochains jours.
      </p>
    )
  }
  return (
    <div>
      {events.map((event, i) => (
        <EventRow key={event.id} event={event} onClick={onEventClick} last={i === events.length - 1} />
      ))}
    </div>
  )
}

export const CalendarView = memo(CalendarViewInner)
