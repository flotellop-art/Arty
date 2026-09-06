import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { CalendarEvent } from '../../types/google'
import { captureCalendarContext, calendarErrorMessage, listEvents, prepareCalendarMutation, type CalendarContext, type PreparedCalendarMutation } from '../../services/calendarClient'
import { getDateLocale } from '../../utils/formatDate'

interface CalendarViewProps {
  days?: number
  onEventClick?: (event: CalendarEvent) => void
  onEventsChange?: (events: CalendarEvent[], error: string | null) => void
}

const PARIS = 'Europe/Paris'
function calendarDay(iso: string): string {
  if (!iso.includes('T')) return iso
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
function displayStart(iso: string): string {
  const timed = iso.includes('T')
  return new Date(timed ? iso : `${iso}T12:00:00Z`).toLocaleString(getDateLocale(), { timeZone: PARIS, dateStyle: 'medium', ...(timed ? { timeStyle: 'short' as const } : {}) })
}
function eventTimeLabel(iso: string): string {
  if (!iso.includes('T')) return new Date(`${iso}T12:00:00Z`).toLocaleDateString(getDateLocale(), { timeZone: PARIS, day: '2-digit', month: 'short' })
  return new Date(iso).toLocaleTimeString(getDateLocale(), { timeZone: PARIS, hour: '2-digit', minute: '2-digit' })
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
function sectionLabel(date: string, t: TFunction): string {
  const today = calendarDay(new Date().toISOString())
  if (date === today) return t('calendar.today')
  const tomorrow = new Date(Date.parse(`${today}T12:00Z`) + 86400_000).toISOString().slice(0, 10)
  if (date === tomorrow) return t('calendar.tomorrow')
  return new Date(`${date}T12:00Z`).toLocaleDateString(getDateLocale(), { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long' })
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
  account,
  deleteReview,
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
  account?: string
  deleteReview?: string
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
          <p className="mb-2 break-words text-xs">{account} · {t('calendarWorkflow.scope')}</p>
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
              date: displayStart(event.start),
            })}
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs">{deleteReview}</pre>
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
  date: string
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
  const [snapshot, setSnapshot] = useState<{ events: CalendarEvent[]; scope: CalendarContext | null } | null>(null)
  const events = snapshot?.events ?? null
  const editingScope = useRef<CalendarContext | null>(null)
  const [deleteReview, setDeleteReview] = useState<PreparedCalendarMutation | null>(null)
  const lifecycle = useRef(new AbortController())
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
      const scope = captureCalendarContext(lifecycle.current.signal)
      const list = await listEvents(days, scope)
      scope!.assertCurrent()
      if (!mountedRef.current || generation !== requestGenerationRef.current) return true
      setSnapshot({ events: list, scope })
      setError(null)
      onEventsChange?.(list, null)
      return true
    } catch (err: unknown) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return false
      const message = err instanceof Error ? err.message : t('calendar.errors.fetchFailed')
      if (preserveOnError) {
        setNotice(previous => ({ kind: 'error', message: `${previous?.message ?? ''} ${t('calendar.editor.errors.refresh')}`.trim() }))
      } else {
        setError(message)
        setSnapshot(null)
        onEventsChange?.([], message)
      }
      return false
    } finally {
      if (mountedRef.current && generation === requestGenerationRef.current && showLoading) setLoading(false)
    }
  }, [days, onEventsChange, t])

  useEffect(() => {
    mountedRef.current = true
    lifecycle.current = new AbortController()
    mutationLockRef.current = false; setMutatingId(null)
    setEditingId(null); setConfirmingDeleteId(null); setDeleteReview(null)
    void loadEvents(true, false)
    return () => {
      mountedRef.current = false
      lifecycle.current.abort()
      requestGenerationRef.current += 1
    }
  }, [loadEvents])

  const publishEvents = useCallback((next: CalendarEvent[]) => {
    setSnapshot(previous => previous && { ...previous, events: next })
    setError(null)
    onEventsChange?.(next, null)
  }, [onEventsChange])

  const beginEdit = useCallback((event: CalendarEvent) => {
    if (mutatingId) return
    setNotice(null)
    setConfirmingDeleteId(null)
    setEditingId(event.id)
    setDraftTitle(event.title)
    editingScope.current = snapshot?.scope ?? null
  }, [mutatingId, snapshot])

  const saveEdit = useCallback(async (event: CalendarEvent) => {
    const title = draftTitle.trim()
    if (!title || mutatingId || mutationLockRef.current) return
    mutationLockRef.current = true
    requestGenerationRef.current += 1
    setMutatingId(event.id)
    setNotice(null)
    const signal = lifecycle.current.signal, scope = editingScope.current
    try {
      const prepared = prepareCalendarMutation(scope, 'update', { title }, event.id)
      if (!window.confirm(prepared.review)) return
      await prepared.execute(signal)
      if (!mountedRef.current || signal.aborted) return
      try { scope!.assertCurrent() } catch { return }
      const next = (events ?? []).map((item) => item.id === event.id ? { ...item, title } : item)
      publishEvents(next)
      setEditingId(null)
      setNotice({ kind: 'status', message: t('calendar.editor.saved') })
      await loadEvents(false, true)
    } catch (error) {
      if (mountedRef.current && !signal.aborted) setNotice({ kind: 'error', message: calendarErrorMessage(error) })
    } finally {
      if (mountedRef.current && !signal.aborted) { mutationLockRef.current = false; setMutatingId(null) }
    }
  }, [draftTitle, events, loadEvents, mutatingId, publishEvents, t])

  const removeEvent = useCallback(async (event: CalendarEvent) => {
    if (mutatingId || mutationLockRef.current) return
    mutationLockRef.current = true
    requestGenerationRef.current += 1
    setMutatingId(event.id)
    setNotice(null)
    const signal = lifecycle.current.signal, scope = snapshot?.scope
    try {
      if (!deleteReview || deleteReview.payload.eventId !== event.id) return
      await deleteReview.execute(signal)
      if (!mountedRef.current || signal.aborted) return
      try { scope!.assertCurrent() } catch { return }
      const next = (events ?? []).filter((item) => item.id !== event.id)
      publishEvents(next)
      if (editingId === event.id) setEditingId(null)
      setConfirmingDeleteId(null)
      setNotice({ kind: 'status', message: t('calendar.editor.deleted') })
      requestAnimationFrame(() => noticeRef.current?.focus())
      await loadEvents(false, true)
    } catch (error) {
      if (mountedRef.current && !signal.aborted) setNotice({ kind: 'error', message: calendarErrorMessage(error) })
    } finally {
      if (mountedRef.current && !signal.aborted) { mutationLockRef.current = false; setMutatingId(null) }
    }
  }, [deleteReview, editingId, events, snapshot, loadEvents, mutatingId, publishEvents, t])

  useEffect(() => {
    const invalidate = () => {
      if (!snapshot?.scope) return
      try { snapshot.scope.assertCurrent(); return } catch { /* changed incarnation */ }
      lifecycle.current.abort(); requestGenerationRef.current += 1
      setSnapshot(null); setEditingId(null); setConfirmingDeleteId(null); setDeleteReview(null)
      setMutatingId(null); mutationLockRef.current = false; setNotice(null)
      const message = t('calendarWorkflow.changed')
      setLoading(false); setError(message); onEventsChange?.([], message)
    }
    window.addEventListener('google-storage-ready', invalidate)
    return () => window.removeEventListener('google-storage-ready', invalidate)
  }, [snapshot, onEventsChange, t])

  const refreshButton = <button type="button" className="min-h-11 px-3 text-sm text-theme-accent-text" disabled={!!mutatingId} onClick={() => {
    lifecycle.current.abort(); lifecycle.current = new AbortController()
    setEditingId(null); setConfirmingDeleteId(null); setDeleteReview(null); setNotice(null)
    void loadEvents(true, false)
  }}>{t('calendarWorkflow.refresh')}</button>

  const groups = useMemo<EventGroup[]>(() => {
    if (!events || events.length === 0) return []
    const byKey = new Map<string, EventGroup>()
    for (const event of events) {
      const d = calendarDay(event.start)
      const key = d
      const existing = byKey.get(key)
      if (existing) existing.events.push(event)
      else byKey.set(key, { date: d, events: [event] })
    }
    return Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [events])

  if (loading) {
    return <p className="font-display italic text-sm text-theme-muted text-center py-4">{t('calendar.loading')}</p>
  }
  if (error) {
    return <div><p role="alert" className="font-sans text-xs text-theme-accent text-center py-4">{error}</p>{refreshButton}</div>
  }
  if (groups.length === 0) {
    return (
      <div>
        {refreshButton}
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
      {refreshButton}
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
        <section key={group.date}>
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
                  try { setDeleteReview(prepareCalendarMutation(snapshot?.scope ?? null, 'delete', {}, eventToDelete.id)) }
                  catch (error) { setNotice({ kind: 'error', message: calendarErrorMessage(error) }); return }
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
                account={editingScope.current?.account}
                deleteReview={deleteReview?.review}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export const CalendarView = memo(CalendarViewInner)
