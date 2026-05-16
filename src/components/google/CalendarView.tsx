import { memo, useEffect, useMemo, useState } from 'react'
import type { CalendarEvent } from '../../types/google'
import { listEvents } from '../../services/calendarClient'
import { getDateLocale } from '../../utils/formatDate'

interface CalendarViewProps {
  days?: number
  onEventClick?: (event: CalendarEvent) => void
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

function isTomorrow(d: Date): boolean {
  const t = startOfDay(new Date())
  t.setDate(t.getDate() + 1)
  return isSameDay(d, t)
}

/** Editorial time label for the agenda row (mono accent). */
function eventTimeLabel(startISO: string): string {
  const start = new Date(startISO)
  const hasTime = startISO.includes('T')
  if (!hasTime) return start.toLocaleDateString(getDateLocale(), { day: '2-digit', month: 'short' })
  return start.toLocaleTimeString(getDateLocale(), { hour: '2-digit', minute: '2-digit' })
}

/** Small meta line under the title (duration + location). */
function eventMeta(event: CalendarEvent): string {
  const bits: string[] = []
  const start = new Date(event.start)
  const hasTime = event.start.includes('T')
  if (hasTime && event.end) {
    const end = new Date(event.end)
    const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
    if (mins >= 60) {
      const h = Math.floor(mins / 60)
      const m = mins % 60
      bits.push(m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`)
    } else if (mins > 0) {
      bits.push(`${mins} min`)
    }
  }
  if (event.location) bits.push(event.location)
  return bits.join(' · ')
}

/** Section label ("AUJOURD'HUI", "DEMAIN", "LUN. 22 AVR."). */
function sectionLabel(date: Date): string {
  const today = startOfDay(new Date())
  if (isSameDay(date, today)) return "Aujourd'hui"
  if (isTomorrow(date)) return 'Demain'
  return date.toLocaleDateString(getDateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
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
  const meta = eventMeta(event)
  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(event) : undefined}
      className={`w-full text-left flex gap-4 py-2.5 hover:bg-theme-accent/5 transition-colors ${
        last ? '' : 'border-b border-dotted border-theme-border'
      }`}
    >
      <span className="font-mono text-[11px] font-bold text-theme-accent w-14 shrink-0 pt-0.5 uppercase tracking-[0.05em]">
        {eventTimeLabel(event.start)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-display text-[14px] text-theme-ink leading-[1.25] truncate">
          {event.title}
        </span>
        {meta && (
          <span className="block font-sans text-[11px] text-theme-muted mt-0.5 truncate">
            {meta}
          </span>
        )}
      </span>
    </button>
  )
}

interface EventGroup {
  date: Date
  events: CalendarEvent[]
}

/**
 * Read-only agenda preview. Fetches the next N days of events from Google
 * Calendar via the authenticated proxy and groups them by day with an
 * editorial kicker ("Aujourd'hui", "Demain", "lundi 22 avril"). Purely
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

  const groups = useMemo<EventGroup[]>(() => {
    if (!events || events.length === 0) return []
    const byKey = new Map<string, EventGroup>()
    for (const event of events) {
      const d = startOfDay(new Date(event.start))
      const key = d.toISOString()
      const existing = byKey.get(key)
      if (existing) existing.events.push(event)
      else byKey.set(key, { date: d, events: [event] })
    }
    return Array.from(byKey.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [events])

  if (loading) {
    return <p className="font-display italic text-sm text-theme-muted text-center py-4">Chargement de l'agenda…</p>
  }
  if (error) {
    return <p className="font-sans text-xs text-theme-accent text-center py-4">{error}</p>
  }
  if (groups.length === 0) {
    return (
      <p className="font-display italic text-sm text-theme-muted py-3">
        Rien de prévu dans les {days} prochains jours.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.date.toISOString()}>
          <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1">
            — <span className="capitalize">{sectionLabel(group.date)}</span>
          </p>
          <div>
            {group.events.map((event, i) => (
              <EventRow
                key={event.id}
                event={event}
                onClick={onEventClick}
                last={i === group.events.length - 1}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export const CalendarView = memo(CalendarViewInner)
