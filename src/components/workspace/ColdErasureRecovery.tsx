import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISOLATED_WORKSPACE_ENABLED } from '../../services/workspaceWriter/activation'
import type { AccountErasureState } from '../../services/accountErasureJournal'
import type { ColdErasureAction } from '../../services/workspaceWriter/erasure'
import { ErasureCleanupPendingError } from '../../services/accountErasureReceipt'

/** No private identity, App or OAuth imports. Consent for local-only is distinct
 * from consulting a remote receipt; finishing it abandons remote consultation. */
export default function ColdErasureRecovery({ mode }: { mode: AccountErasureState }) {
  const { t } = useTranslation(), running = useRef(false)
  const actor = useRef<{ resume(action?: ColdErasureAction, signal?: AbortSignal): Promise<unknown> }>()
  const life = useRef<AbortController>()
  useEffect(() => { const controller = new AbortController(); life.current = controller; return () => controller.abort() }, [])
  const [state, setState] = useState<'idle' | 'working' | 'failed' | 'cleanupPending' | 'done' | 'cancelled'>('idle')
  const [armed, setArmed] = useState(false)
  const [localChosen, setLocalChosen] = useState(false)
  const statusElement = useRef<HTMLParagraphElement>(null), previousState = useRef(state)
  useEffect(() => {
    if (previousState.current === 'working' && state !== 'working') statusElement.current?.focus()
    previousState.current = state
  }, [state])
  const copy = (key: string) => t(`workspaceAdmission.erasureRecovery.${key}`)
  const run = async (action: ColdErasureAction) => {
    const lifecycle = life.current
    if (!ISOLATED_WORKSPACE_ENABLED || !lifecycle || lifecycle.signal.aborted || running.current || (action === 'local-only' && !armed && !localChosen) ||
      action === 'resume-remote-cleanup' && state !== 'cleanupPending') return
    running.current = true; setArmed(false); setState('working')
    if (action === 'local-only') setLocalChosen(true)
    try {
      const module = await import('../../services/workspaceWriter/erasure')
      if (lifecycle.signal.aborted || life.current !== lifecycle) return
      actor.current ??= module.createColdWorkspaceErasure()
      await actor.current.resume(action, lifecycle.signal)
      if (!lifecycle.signal.aborted && life.current === lifecycle) setState(action === 'cancel-not-sent' ? 'cancelled' : 'done')
    } catch (error) { if (!lifecycle.signal.aborted && life.current === lifecycle) setState(error instanceof ErasureCleanupPendingError ? 'cleanupPending' : 'failed') }
    finally { running.current = false }
  }
  const button = 'mt-4 min-h-11 rounded-lg border border-theme-border px-5 py-3 disabled:opacity-50'
  const effectiveMode = localChosen ? 'local-only' : mode
  const selectable = ['uncertain', 'not-sent', 'legacy-unknown'].includes(effectiveMode)
  const primary = effectiveMode === 'uncertain' ? 'verify' : 'resume'
  return <>
    <p ref={statusElement} tabIndex={-1} className="mt-4 text-sm leading-relaxed text-theme-muted" role="status">{copy(!ISOLATED_WORKSPACE_ENABLED ? 'disabled' : state === 'idle' && selectable ? effectiveMode : state)}</p>
    {ISOLATED_WORKSPACE_ENABLED && (state === 'done' || state === 'cancelled'
      ? <button type="button" className={button} onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>
      : armed ? <>
        <p className="mt-4 text-sm" role="alert">{copy('localWarning')}</p>
        <button type="button" className={button} onClick={() => { void run('local-only') }}>{copy('confirmLocal')}</button>
        <button type="button" className={button} onClick={() => setArmed(false)}>{copy('back')}</button>
      </> : <div className="flex flex-col">
        {state === 'cleanupPending' && !localChosen && <button type="button" className={button} onClick={() => { void run('resume-remote-cleanup') }}>{copy('cleanupContinue')}</button>}
        {effectiveMode !== 'not-sent' && effectiveMode !== 'legacy-unknown' && <button type="button" disabled={state === 'working'} className={button} onClick={() => { void run(localChosen ? 'local-only' : 'resume') }}>{copy(primary)}</button>}
        {effectiveMode === 'not-sent' && <button type="button" disabled={state === 'working'} className={button} onClick={() => { void run('cancel-not-sent') }}>{copy('cancelNotSent')}</button>}
        {selectable && <button type="button" disabled={state === 'working'} className={button} onClick={() => setArmed(true)}>{copy('localOnly')}</button>}
      </div>)}
    {ISOLATED_WORKSPACE_ENABLED && state === 'failed' && <button type="button" className={button} onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>}
  </>
}
