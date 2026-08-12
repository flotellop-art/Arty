import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { CalendarEvent } from '../../types/google'
import { deleteEvent, listEvents, updateEvent } from '../../services/calendarClient'
import { getDateLocale } from '../../utils/formatDate'

interface CalendarViewProps {
  days?: number
  onEventClick?: (event: CalendarEvent) => void
  onEventsChange?: (events: CalendarEvent[], error: string | null) => void
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
function sectionLabel(date: Date, t: TFunction): string {
  const today = startOfDay(new Date())
  if (isSameDay(date, today)) return t('calendar.today')
  if (isTomorrow(date)) return t('calendar.tomorrow')
  return date.toLocaleDateString(getDateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function EventRow({
  event,
  onClick,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  editing,
  confirmingDelete,
  draftTitle,
  onDraftTitleChange,
  onSave,
  onCancelEdit,
  busy,
  last,
}: {
  event: CalendarEvent
  onClick?: (event: CalendarEvent) => void
  onEdit: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
  onConfirmDelete: (event: CalendarEvent) => void
  onCancelDelete: () => void
  editing: boolean
  confirmingDelete: boolean
  draftTitle: string
  onDraftTitleChange: (value: string) => void
  onSave: (event: CalendarEvent) => void
  onCancelEdit: () => void
  busy: boolean
  last: boolean
}) {
  const { t } = useTranslation()
  const meta = eventMeta(event)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const confirmDescriptionId = useId()

  useEffect(() => {
    if (confirmingDelete) requestAnimationFrame(() => cancelDeleteRef.current?.focus())
  }, [confirmingDelete])

  const cancelDelete = () => {
    if (busy) return
    onCancelDelete()
    requestAnimationFrame(() => deleteTriggerRef.current?.focus())
  }
  return (
    <article
      className={`py-2.5 ${
        last ? '' : 'border-b border-dotted border-theme-border'
      }`}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 max-[420px]:grid-cols-2">
        <button
          type="button"
          onClick={onClick ? () => onClick(event) : undefined}
          disabled={busy}
          aria-label={t('calendar.editor.openAria', { title: event.title })}
          className="flex min-h-11 min-w-0 gap-4 rounded-lg px-1 py-2 text-left transition-colors hover:bg-theme-accent/5 disabled:cursor-default disabled:opacity-60 max-[420px]:col-span-2"
        >
          <span className="w-14 shrink-0 pt-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-theme-accent">
            {eventTimeLabel(event.start)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[14px] leading-[1.25] text-theme-ink">
              {event.title}
            </span>
            {meta && (
              <span className="mt-0.5 block truncate font-sans text-[11px] text-theme-muted">
                {meta}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onEdit(event)}
          disabled={busy}
          aria-label={t('calendar.editor.editAria', { title: event.title })}
          className="min-h-11 shrink-0 rounded-lg px-3 font-sans text-xs text-theme-accent-text hover:bg-theme-accent/5 disabled:opacity-50"
        >
          {t('calendar.editor.edit')}
        </button>
        <button
          ref={deleteTriggerRef}
          type="button"
          onClick={() => onDelete(event)}
          disabled={busy}
          aria-label={t('calendar.editor.deleteAria', { title: event.title })}
          className="min-h-11 shrink-0 rounded-lg px-3 font-sans text-xs text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
        >
          {t('calendar.editor.delete')}
        </button>
      </div>
      {editing && (
        <form
          className="mt-2 rounded-xl border border-theme-border bg-theme-surface p-3"
          onSubmit={(eventSubmit) => {
            eventSubmit.preventDefault()
            onSave(event)
          }}
        >
          <label className="block font-sans text-xs font-semibold text-theme-ink">
            {t('calendar.editor.title')}
            <input
              autoFocus
              value={draftTitle}
              disabled={busy}
              onChange={(changeEvent) => onDraftTitleChange(changeEvent.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-theme-border bg-theme-bg px-3 font-sans text-sm font-normal text-theme-ink focus:border-theme-accent focus:outline-none disabled:opacity-60"
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={busy}
              className="min-h-11 rounded-lg px-3 font-sans text-xs text-theme-muted hover:bg-theme-ink/5 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || !draftTitle.trim()}
              className="min-h-11 rounded-lg bg-theme-accent px-4 font-sans text-xs font-semibold text-theme-bg disabled:opacity-50"
            >
              {busy ? t('common.loading') : t('calendar.editor.save')}
            </button>
          </div>
        </form>
      )}
      {confirmingDelete && (
        <section
          className="mt-2 rounded-xl border border-red-700/30 bg-red-500/10 p-3"
          role="alertdialog"
          aria-label={t('calendar.editor.confirmDeleteAria', { title: event.title })}
          aria-describedby={confirmDescriptionId}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key !== 'Escape') return
            keyEvent.preventDefault()
            cancelDelete()
          }}
        >
          <p id={confirmDescriptionId} className="font-sans text-sm leading-relaxed text-theme-ink">
            {t('calendar.editor.confirmDelete', {
              title: event.title,
              date: new Date(event.start).toLocaleString(getDateLocale(), {
                dateStyle: 'medium',
                timeStyle: event.start.includes('T') ? 'short' : undefined,
              }),
            })}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              ref={cancelDeleteRef}
              type="button"
              onClick={cancelDelete}
              disabled={busy}
              className="min-h-11 rounded-lg border border-theme-border px-3 font-sans text-xs text-theme-ink disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => onConfirmDelete(event)}
              disabled={busy}
              className="min-h-11 rounded-lg bg-red-700 px-3 font-sans text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? t('common.loading') : t('calendar.editor.moveToTrash')}
            </button>
          </div>
        </section>
      )}
    </article>
  )
}

interface EventGroup {
  date: Date
  events: CalendarEvent[]
}

/**
 * Agenda preview and explicit user-controlled title/delete editor. Fetches the
 * next N days from Google Calendar through the authenticated proxy. Mutations
 * always use the opaque event id returned by Google; deletion requires an
 * additional confirmation in Arty.
 */
function CalendarViewInner({ days = 7, onEventClick, onEventsChange }: CalendarViewProps) {
  const { t } = useTranslation()
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'status' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const mutationLockRef = useRef(false)
  const mountedRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const noticeRef = useRef<HTMLParagraphElement>(null)

  const loadEvents = useCallback(async (showLoading: boolean, preserveOnError: boolean) => {
    const generation = ++requestGenerationRef.current
    if (showLoading) setLoading(true)
    try {
      const list = await listEvents(days)
      if (!mountedRef.current || generation !== requestGenerationRef.current) return true
        setEvents(list)
        setError(null)
        onEventsChange?.(list, null)
      return true
    } catch (err: unknown) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return false
      const message = err instanceof Error ? err.message : t('calendar.errors.fetchFailed')
      if (preserveOnError) {
        setNotice({ kind: 'error', message: t('calendar.editor.errors.refresh') })
      } else {
        setError(message)
        setEvents([])
        onEventsChange?.([], message)
      }
      return false
    } finally {
      if (mountedRef.current && generation === requestGenerationRef.current && showLoading) setLoading(false)
    }
  }, [days, onEventsChange, t])

  useEffect(() => {
    mountedRef.current = true
    void loadEvents(true, false)
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
    }
  }, [loadEvents])

  const publishEvents = useCallback((next: CalendarEvent[]) => {
    setEvents(next)
    setError(null)
    onEventsChange?.(next, null)
  }, [onEventsChange])

  const beginEdit = useCallback((event: CalendarEvent) => {
    if (mutatingId) return
    setNotice(null)
    setConfirmingDeleteId(null)
    setEditingId(event.id)
    setDraftTitle(event.title)
  }, [mutatingId])

  const saveEdit = useCallback(async (event: CalendarEvent) => {
    const title = draftTitle.trim()
    if (!title || mutatingId || mutationLockRef.current) return
    mutationLockRef.current = true
    requestGenerationRef.current += 1
    setMutatingId(event.id)
    setNotice(null)
    try {
      await updateEvent(event.id, { title })
      if (!mountedRef.current) return
      const next = (events ?? []).map((item) => item.id === event.id ? { ...item, title } : item)
      publishEvents(next)
      setEditingId(null)
      setNotice({ kind: 'status', message: t('calendar.editor.saved') })
      await loadEvents(false, true)
    } catch {
      if (mountedRef.current) setNotice({ kind: 'error', message: t('calendar.editor.errors.update') })
    } finally {
      mutationLockRef.current = false
      if (mountedRef.current) setMutatingId(null)
    }
  }, [draftTitle, events, loadEvents, mutatingId, publishEvents, t])

  const removeEvent = useCallback(async (event: CalendarEvent) => {
    if (mutatingId || mutationLockRef.current) return
    mutationLockRef.current = true
    requestGenerationRef.current += 1
    setMutatingId(event.id)
    setNotice(null)
    try {
      await deleteEvent(event.id)
      if (!mountedRef.current) return
      const next = (events ?? []).filter((item) => item.id !== event.id)
      publishEvents(next)
      if (editingId === event.id) setEditingId(null)
      setConfirmingDeleteId(null)
      setNotice({ kind: 'status', message: t('calendar.editor.deleted') })
      requestAnimationFrame(() => noticeRef.current?.focus())
      await loadEvents(false, true)
    } catch {
      if (mountedRef.current) setNotice({ kind: 'error', message: t('calendar.editor.errors.delete') })
    } finally {
      mutationLockRef.current = false
      if (mountedRef.current) setMutatingId(null)
    }
  }, [editingId, events, loadEvents, mutatingId, publishEvents, t])

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
    return <p className="font-display italic text-sm text-theme-muted text-center py-4">{t('calendar.loading')}</p>
  }
  if (error) {
    return <p className="font-sans text-xs text-theme-accent text-center py-4">{error}</p>
  }
  if (groups.length === 0) {
    return (
      <div>
        {notice && (
          <p
            ref={noticeRef}
            className="font-sans text-xs text-theme-accent-text"
            role={notice.kind === 'error' ? 'alert' : 'status'}
            aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
            tabIndex={-1}
          >
            {notice.message}
          </p>
        )}
        <p className="py-3 font-display text-sm italic text-theme-muted">
          {t('calendar.empty', { days })}
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p
          ref={noticeRef}
          className="font-sans text-xs text-theme-accent-text"
          role={notice.kind === 'error' ? 'alert' : 'status'}
          aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
          tabIndex={-1}
        >
          {notice.message}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.date.toISOString()}>
          <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1">
            — <span className="capitalize">{sectionLabel(group.date, t)}</span>
          </p>
          <div>
            {group.events.map((event, i) => (
              <EventRow
                key={event.id}
                event={event}
                onClick={onEventClick}
                onEdit={beginEdit}
                onDelete={(eventToDelete) => {
                  if (mutatingId || mutationLockRef.current) return
                  setNotice(null)
                  setEditingId(null)
                  setConfirmingDeleteId(eventToDelete.id)
                }}
                onConfirmDelete={removeEvent}
                onCancelDelete={() => setConfirmingDeleteId(null)}
                editing={editingId === event.id}
                confirmingDelete={confirmingDeleteId === event.id}
                draftTitle={editingId === event.id ? draftTitle : ''}
                onDraftTitleChange={setDraftTitle}
                onSave={saveEdit}
                onCancelEdit={() => setEditingId(null)}
                busy={mutatingId === event.id}
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
