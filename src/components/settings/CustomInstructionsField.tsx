import { useEffect, useId, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { bootstrapCustomInstructions, getCustomInstructionsSnapshot, subscribeCustomInstructions, setCustomInstructions, MAX_CUSTOM_INSTRUCTIONS_CHARS, type CustomInstructionsSnapshot } from '../../services/customInstructions'
import { captureLocalReadScope } from '../../services/projects/store'
import { onLocalDataInvalidated } from '../../services/localDataInvalidation'
import { waitForLocalMemory } from '../../services/localMemoryWait'

type Editor = { value: string; base: CustomInstructionsSnapshot; assertOwner: () => void }
export function CustomInstructionsField({ closeGuard }: { closeGuard?: MutableRefObject<() => boolean> }) {
  const { t } = useTranslation(), id = useId()
  const snapshot = useSyncExternalStore(subscribeCustomInstructions, getCustomInstructionsSnapshot)
  const [editor, setEditor] = useState<Editor | null>(null), editorRef = useRef<Editor | null>(null)
  const [busy, setBusy] = useState(false), busyRef = useRef(false)
  const [error, setError] = useState(false), needsRead = useRef(false)
  const [conflict, setConflict] = useState(false), conflictRef = useRef(false)
  const mounted = useRef(false), ticket = useRef(0), lifetime = useRef<AbortController | null>(null)
  const updateEditor = (next: Editor | null) => { editorRef.current = next; setEditor(next) }
  const ownerCurrent = (value: Editor | null) => { try { value?.assertOwner(); return !!value } catch { return false } }
  const load = async (preserveDraft: boolean) => {
    const operation = ++ticket.current, prior = preserveDraft ? editorRef.current : null
    lifetime.current?.abort(); busyRef.current = true; setBusy(true)
    if (!preserveDraft) { updateEditor(null); setConflict(false); conflictRef.current = false }
    try {
      await bootstrapCustomInstructions()
      if (!mounted.current || ticket.current !== operation) return
      const base = getCustomInstructionsSnapshot()
      if (base.status !== 'ready') throw new Error('instructions_not_ready')
      const scope = captureLocalReadScope()
      if (prior) prior.assertOwner()
      const changed = !!prior && prior.base.value !== base.value && prior.value !== base.value
      updateEditor({ value: prior?.value ?? base.value, base, assertOwner: scope.assertCurrent })
      conflictRef.current = changed; setConflict(changed)
      needsRead.current = false; setError(false)
    } catch {
      if (mounted.current && ticket.current === operation) { needsRead.current = true; setError(true) }
    } finally {
      if (mounted.current && ticket.current === operation) { busyRef.current = false; setBusy(false) }
    }
  }
  useEffect(() => {
    mounted.current = true
    void load(false)
    const stop = onLocalDataInvalidated(() => { void load(false) })
    return () => { mounted.current = false; ticket.current++; lifetime.current?.abort(); stop() }
  }, [])
  useEffect(() => {
    // Auth may finish hydration after the first provisional mount failed.
    if (snapshot.status === 'ready' && !editorRef.current && !busyRef.current) void load(false)
    const current = editorRef.current
    // Only clean editors follow new durable values. Dirty drafts retain their
    // original owner and exact base until an explicit reread/conflict decision.
    if (snapshot.status === 'ready' && current && ownerCurrent(current) && !busyRef.current && !needsRead.current &&
        current.value === current.base.value && current.base !== snapshot) updateEditor({ ...current, value: snapshot.value, base: snapshot })
  }, [snapshot, busy])

  const save = async (replaceConfirmed = false) => {
    const draft = editorRef.current
    if (!draft || !ownerCurrent(draft) || busyRef.current || needsRead.current ||
        (conflictRef.current && !replaceConfirmed) || draft.value === draft.base.value) return
    busyRef.current = true; setBusy(true); setError(false)
    const operation = ++ticket.current, controller = new AbortController()
    lifetime.current = controller
    const assertCurrent = () => {
      draft.assertOwner()
      if (!mounted.current || operation !== ticket.current || controller.signal.aborted) throw new Error('instructions_edit_cancelled')
    }
    try {
      await waitForLocalMemory(setCustomInstructions(draft.value, assertCurrent, draft.base), controller.signal, 10000, () => controller.abort())
      assertCurrent()
      const base = getCustomInstructionsSnapshot()
      if (base.status !== 'ready' || base.value !== draft.value) throw new Error('instructions_ack_uncertain')
      updateEditor({ ...draft, base }); conflictRef.current = false; setConflict(false)
    } catch {
      if (mounted.current && operation === ticket.current && ownerCurrent(draft)) { needsRead.current = true; setError(true) }
    } finally {
      controller.abort()
      if (mounted.current && operation === ticket.current) { busyRef.current = false; setBusy(false) }
    }
  }

  const valid = ownerCurrent(editor), dirty = valid && editor!.value !== editor!.base.value
  const stale = valid && snapshot.status === 'ready' && editor!.base !== snapshot
  useEffect(() => {
    const hasPending = () => ownerCurrent(editorRef.current) && (busyRef.current || editorRef.current!.value !== editorRef.current!.base.value)
    const guard = () => !hasPending() || window.confirm(t('settings.customInstructions.discard'))
    if (closeGuard) closeGuard.current = guard
    const beforeUnload = (event: BeforeUnloadEvent) => { if (hasPending()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { if (closeGuard?.current === guard) closeGuard.current = () => true; window.removeEventListener('beforeunload', beforeUnload) }
  }, [closeGuard, t])

  return <div className="border-t border-theme-border pt-5">
    <label htmlFor={id} className="font-display text-base text-theme-ink">📝 {t('settings.customInstructions.title')}</label>
    <p id={`${id}-help`} className="font-display italic text-xs text-theme-muted mt-0.5">{t('settings.customInstructions.description')}</p>
    <textarea id={id} aria-describedby={`${id}-help`} value={valid ? editor!.value : ''}
      onChange={event => { if (editorRef.current && ownerCurrent(editorRef.current)) updateEditor({ ...editorRef.current, value: event.target.value.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS) }) }}
      onBlur={() => { void save() }} disabled={!valid || busy || snapshot.status !== 'ready'} rows={3} maxLength={MAX_CUSTOM_INSTRUCTIONS_CHARS}
      placeholder={t('settings.customInstructions.placeholder')}
      className="mt-2 w-full rounded-xl border border-theme-border bg-theme-bg px-3 py-2 text-sm text-theme-ink placeholder:text-theme-muted/60 focus:outline-none focus:border-theme-accent transition-colors resize-none disabled:opacity-50" />
    <p className="text-right font-mono text-[10px] text-theme-muted mt-0.5">{valid ? editor!.value.length : 0}/{MAX_CUSTOM_INSTRUCTIONS_CHARS}</p>
    {error && <p role="alert" className="text-xs text-red-500">{t('settings.customInstructions.unavailable')}</p>}
    {stale && !error && <p role="status" className="text-xs text-theme-muted">{t('settings.customInstructions.stale')}</p>}
    {conflict && valid && <div role="alert" className="text-xs text-theme-muted">
      <p>{t('settings.customInstructions.conflict')}</p>
      <pre className="whitespace-pre-wrap">{editor!.base.value || t('settings.customInstructions.empty')}</pre>
      <button type="button" disabled={busy || error} className="underline mr-3" onClick={() => { void save(true) }}>{t('settings.customInstructions.replace')}</button>
      <button type="button" disabled={busy || error} className="underline" onClick={() => { if (!ownerCurrent(editorRef.current)) return; updateEditor({ ...editorRef.current!, value: editorRef.current!.base.value }); conflictRef.current = false; setConflict(false) }}>{t('settings.customInstructions.keepStored')}</button>
    </div>}
    {(error || stale || (!valid && !busy) || snapshot.status === 'idle') && <button type="button" disabled={busy} className="underline text-sm" onClick={() => { void load(true) }}>{t('settings.customInstructions.reread')}</button>}
    <button type="button" disabled={!dirty || busy || error || conflict || snapshot.status !== 'ready'} className="mt-2 px-3 py-1 rounded border border-theme-border text-sm disabled:opacity-50" onClick={() => { void save() }}>{t('settings.customInstructions.save')}</button>
    <p role="status" className="text-xs text-theme-muted mt-1">{busy ? t('settings.customInstructions.pending') : valid && !dirty && !error && !stale && snapshot.status === 'ready' ? t('settings.customInstructions.stored') : ''}</p>
  </div>
}
