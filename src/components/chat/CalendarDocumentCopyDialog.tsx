import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { CalendarCopyError, type CalendarCopySource } from '../../services/workflows/calendarDocumentCopy'
import { CalendarError, calendarErrorMessage, type PreparedCalendarMutation } from '../../services/calendarClient'
import type { CalendarCopyOpening } from './useCalendarDocumentCopy'

type Phase = 'loading' | 'preview' | 'adopting' | 'draft' | 'review' | 'submitting' | 'done' | 'failed'
const emptyDraft = () => ({ title: '', start: '', end: '', location: '', description: '' })
const button = 'min-h-11 px-4 rounded-lg border border-theme-border disabled:opacity-40'
const input = 'block w-full min-w-0 rounded border border-theme-border bg-theme-bg p-2 text-theme-ink'

/** One semantic dialog, raw inert source, independent manual fields. No draft
 * persistence, provider request or Calendar listing before explicit confirm. */
export function CalendarDocumentCopyDialog({ opening, onClose }: { opening: CalendarCopyOpening; onClose(): void }) {
  const { t } = useTranslation(), id = useId(), actor = opening.actor
  const [phase, setPhase] = useState<Phase>(opening.done ? 'done' : opening.error ? 'failed' : 'loading')
  const phaseRef = useRef<Phase>(phase), alive = useRef(false)
  const [source, setSource] = useState<CalendarCopySource | null>(null), [account, setAccount] = useState('')
  const [draft, setDraft] = useState(emptyDraft), [error, setError] = useState<unknown>(opening.error)
  const [review, setReview] = useState<PreparedCalendarMutation | null>(null)
  const currentReview = useRef<PreparedCalendarMutation | null>(null), textRef = useRef<HTMLTextAreaElement>(null)
  const transition = (next: Phase) => { phaseRef.current = next; setPhase(next) }
  const clearPrivate = () => { setSource(null); setAccount(''); setDraft(emptyDraft()); setReview(null); currentReview.current = null }
  const fail = (reason: unknown) => {
    // A late polling failure cannot revoke an already verified public receipt.
    if (actor?.hasConfirmed) { clearPrivate(); setError(null); transition('done'); return }
    const failure = actor?.hasAttempted && !(reason instanceof CalendarError) ? new CalendarError('unknown') : reason
    actor?.dispose(); clearPrivate(); setError(failure); transition('failed')
  }
  const close = () => { actor?.dispose(); phaseRef.current = 'failed'; onClose() }
  const dialog = useDialogFocusTrap<HTMLDivElement>(true, close)

  useEffect(() => {
    alive.current = true
    let stopped = false, checking = false
    const check = async () => {
      if (!actor || stopped || checking || ['failed', 'done'].includes(phaseRef.current)) return
      checking = true
      try {
        await actor.validate()
        if (!stopped && phaseRef.current === 'loading') { setSource(actor.source); setAccount(actor.account); transition('preview') }
      } catch (reason) { if (!stopped) fail(reason) }
      finally { checking = false }
    }
    void check()
    const timer = window.setInterval(() => void check(), 250)
    return () => { stopped = true; alive.current = false; window.clearInterval(timer) }
    // An opening never changes authority; its parent replaces it on revocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor])
  useEffect(() => {
    const blockDrawerShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopImmediatePropagation() }
    }
    document.addEventListener('keydown', blockDrawerShortcut, true)
    return () => document.removeEventListener('keydown', blockDrawerShortcut, true)
  }, [])
  useEffect(() => {
    const target = dialog.current?.querySelector<HTMLElement>('[data-phase-focus]')
    target?.focus()
  }, [phase, dialog])
  // Also trap focus that arrives from the dialog root/body or programmatically
  // from behind the overlay. The shared hook handles first/last wrapping.
  useEffect(() => {
    const contain = () => {
      const root = dialog.current
      if (root && (!root.contains(document.activeElement) || document.activeElement === root)) {
        root.querySelector<HTMLElement>('button:not([disabled])')?.focus()
      }
    }
    document.addEventListener('focusin', contain)
    return () => document.removeEventListener('focusin', contain)
  }, [dialog])

  const adopt = async () => {
    if (!actor || phaseRef.current !== 'preview') return
    transition('adopting'); setError(null)
    try { await actor.adopt(); if (alive.current) transition('draft') }
    catch (reason) { if (alive.current) fail(reason) }
  }
  const edit = () => {
    if (phaseRef.current !== 'review') return
    actor?.discardReview(); currentReview.current = null; setReview(null); setError(null); transition('draft')
  }
  const update = (key: keyof ReturnType<typeof emptyDraft>, value: string) => {
    if (phaseRef.current !== 'draft') return
    actor?.discardReview(); currentReview.current = null; setReview(null); setError(null)
    setDraft(old => ({ ...old, [key]: value }))
  }
  const selectNotes = () => {
    const text = textRef.current
    if (!text || phaseRef.current !== 'draft') return
    const selected = text.value.slice(text.selectionStart, text.selectionEnd)
    if (!selected) { setError(new Error(t('calendarCopy.selectionRequired'))); return }
    if (draft.description.length + selected.length > 8192) { setError(new Error(t('calendarCopy.notesLimit'))); return }
    update('description', draft.description + selected)
  }
  const prepare = () => {
    if (!actor || phaseRef.current !== 'draft') return
    try {
      const prepared = actor.prepare(draft)
      currentReview.current = prepared; setReview(prepared); setError(null); transition('review')
    } catch (reason) { setError(reason) }
  }
  const confirm = async (prepared: PreparedCalendarMutation) => {
    if (phaseRef.current !== 'review' || currentReview.current !== prepared) return
    transition('submitting'); currentReview.current = null; setError(null)
    try { await prepared.execute(); if (alive.current) { clearPrivate(); transition('done') } }
    catch (reason) { if (alive.current) fail(reason) }
  }
  const message = error instanceof CalendarCopyError ? t(error.message) : error instanceof Error &&
    [t('calendarCopy.selectionRequired'), t('calendarCopy.notesLimit')].includes(error.message) ? error.message : calendarErrorMessage(error)
  let current = true
  try { actor?.assertCurrent() } catch { current = false }
  const privateVisible = current && !opening.error && phase !== 'failed' && phase !== 'done'
  return <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-3">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
      className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-xl bg-theme-bg text-theme-ink p-4 space-y-4 shadow-xl">
      <div className="flex gap-3 items-start justify-between"><h2 id={`${id}-title`} className="text-lg font-semibold">{t('calendarCopy.title')}</h2>
        <button className={button} onClick={close}>{t('common.close')}</button></div>
      {privateVisible && <>
        {account && <p className="break-all">{t('calendarWorkflow.account', { account })}</p>}
        {phase === 'loading' && <p role="status">{t('calendarCopy.loading')}</p>}
        {source && ['preview', 'adopting', 'draft'].includes(phase) && <>
          <p>{t(phase === 'draft' ? 'calendarCopy.independent' : 'calendarCopy.previewNotice')}</p>
          <p className="break-words text-sm">{source.title} · {source.messageId} · {new Date(source.timestamp).toISOString()}</p>
          <label className="block">{t('calendarCopy.sourceText')} ({source.text.length}/200000)
            <textarea ref={textRef} readOnly value={source.text} rows={7} className={input} /></label>
          <p className="text-sm">{t('calendarCopy.exclusions')}</p>
          {source.verificationPending && <p role="note">{t('calendarCopy.pendingVerification')}</p>}
          {!!source.references.length && <details><summary>{t('calendarCopy.references')}</summary>
            {source.references.map((ref, i) => <p key={i} className="break-all text-xs">{ref}</p>)}
          </details>}
        </>}
        {['preview', 'adopting'].includes(phase) && <button data-phase-focus className={button} disabled={phase === 'adopting'} onClick={() => void adopt()}>{t('calendarCopy.adopt')}</button>}
        {phase === 'draft' && <form onSubmit={e => { e.preventDefault(); prepare() }} className="space-y-3">
          <p>{t('calendarCopy.manual')}</p>
          <p className="text-sm">{t('calendarCopy.dateFormat')}</p>
          <button type="button" className={button} onClick={selectNotes}>{t('calendarCopy.useSelection')}</button>
          {(['title', 'start', 'end', 'location', 'description'] as const).map(key => <label key={key} className="block">
            {t(`calendarWorkflow.fields.${key}`)}{!['start', 'end'].includes(key) && ` (${draft[key].length}/${key === 'description' ? 8192 : 1024})`}
            {key === 'description' ? <textarea rows={5} value={draft[key]} className={input} onChange={e => update(key, e.target.value)} /> :
              <input data-phase-focus={key === 'title' ? '' : undefined} required={['title', 'start', 'end'].includes(key)}
                type="text" placeholder={['start', 'end'].includes(key) ? '2026-10-25T02:30+02:00' : undefined} value={draft[key]} className={input} onChange={e => update(key, e.target.value)} />}
          </label>)}
          <button type="submit" className={button}>{t('calendarCopy.review')}</button>
        </form>}
        {review && ['review', 'submitting'].includes(phase) && <>
          <p>{t('calendarCopy.reviewNotice')}</p>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{review.review}</pre>
          <p role="note">{t('calendarCopy.dispatchNotice')}</p>
          {phase === 'review' ? <div className="flex flex-wrap gap-3">
            <button data-phase-focus className={button} onClick={edit}>{t('calendarCopy.edit')}</button>
            <button className={button} onClick={() => void confirm(review)}>{t('calendarCopy.confirm')}</button>
          </div> : <p role="status">{t('calendarCopy.submitting')}</p>}
        </>}
      </>}
      {phase === 'done' && <p role="status" tabIndex={-1} data-phase-focus>{t('calendarCopy.done')}</p>}
      {(!!error || !current || !!opening.error) && <p role="alert" tabIndex={-1} data-phase-focus>{!current && !error ? t('calendarCopy.errors.changed') : message}</p>}
    </div>
  </div>
}
