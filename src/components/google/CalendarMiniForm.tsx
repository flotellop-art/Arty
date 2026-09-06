import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { calendarErrorMessage, prepareCalendarMutation, type CalendarContext, type PreparedCalendarMutation } from '../../services/calendarClient'
import { toLocalCalendarDateTime } from '../../utils/calendarDateTime'

export interface CalendarMiniFormProps {
  detected: { text: string; date: Date }
  context: string
  scope: CalendarContext | null
  onComplete(): void
  onCancel(): void
}

/** Both composer versions use this same local review and execute-once handle. */
export function CalendarMiniForm({ detected, context, scope, onComplete, onCancel }: CalendarMiniFormProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(() => context.trim().slice(0, 80) || detected.text)
  const [start, setStart] = useState(() => toLocalCalendarDateTime(detected.date).slice(0, 16))
  const [end, setEnd] = useState(() => {
    const wall = toLocalCalendarDateTime(detected.date)
    return new Date(Date.parse(`${wall}Z`) + 3600_000).toISOString().slice(0, 16)
  })
  const [review, setReview] = useState<PreparedCalendarMutation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const lock = useRef(false), controller = useRef(new AbortController())
  useEffect(() => { const current = new AbortController(); controller.current = current; return () => current.abort() }, [])
  const prepare = () => {
    try { setReview(prepareCalendarMutation(scope, 'create', { title, start, end })); setError(null) }
    catch (error) { setError(calendarErrorMessage(error)) }
  }
  const confirm = async () => {
    if (!review || lock.current) return
    lock.current = true; setBusy(true); setAttempted(true)
    const signal = controller.current.signal
    try {
      await review.execute(signal)
      if (signal.aborted) return
      try { scope!.assertCurrent() } catch { return }
      onComplete()
    } catch (error) {
      if (!signal.aborted) setError(calendarErrorMessage(error))
    } finally { if (!signal.aborted) setBusy(false) }
  }
  return <section aria-label={t('calendarWorkflow.formTitle')} className="mb-2 border border-theme-accent/30 bg-theme-surface p-3 text-sm text-theme-ink">
    <p>{t('calendarWorkflow.scope')} · {scope?.account || t('calendarWorkflow.disconnected')}</p>
    {error && <p role="alert" className="my-2">{error}</p>}
    {review ? <pre className="my-3 whitespace-pre-wrap break-words font-sans">{review.review}</pre> : <>
      <label className="mt-2 block">{t('calendarWorkflow.fields.title')}<input className="block min-h-11 w-full bg-theme-bg" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="mt-2 block">{t('calendarWorkflow.start')}<input className="block min-h-11 w-full bg-theme-bg" type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label>
      <label className="mt-2 block">{t('calendarWorkflow.end')}<input className="block min-h-11 w-full bg-theme-bg" type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label>
    </>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="min-h-11 px-3" disabled={busy} onClick={onCancel}>{attempted ? t('calendarWorkflow.close') : t('calendarWorkflow.cancel')}</button>
      {review && !attempted && <button type="button" className="min-h-11 px-3" onClick={() => setReview(null)}>{t('calendarWorkflow.editDraft')}</button>}
      <button type="button" className="min-h-11 border border-theme-accent px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || attempted || !scope} onClick={review ? () => void confirm() : prepare}>
        {busy ? t('calendarWorkflow.sending') : review ? t('calendarWorkflow.confirmCreate') : t('calendarWorkflow.review')}
      </button>
    </div>
  </section>
}
