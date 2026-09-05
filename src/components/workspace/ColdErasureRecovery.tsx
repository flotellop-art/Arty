import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISOLATED_WORKSPACE_ENABLED } from '../../services/workspaceWriter/activation'
import type { AccountErasureState } from '../../services/accountErasureJournal'
import type { ColdErasureAction } from '../../services/workspaceWriter/erasure'

/** No private identity, App or OAuth imports. Consent for local-only is distinct
 * from consulting a remote receipt; finishing it abandons remote consultation. */
export default function ColdErasureRecovery({ mode }: { mode: AccountErasureState }) {
  const { t } = useTranslation(), running = useRef(false)
  const actor = useRef<{ resume(action?: ColdErasureAction): Promise<unknown> }>()
  const [state, setState] = useState<'idle' | 'working' | 'failed' | 'done' | 'cancelled'>('idle')
  const [armed, setArmed] = useState(false)
  const [localChosen, setLocalChosen] = useState(false)
  const copy = (key: string) => t(`workspaceAdmission.erasureRecovery.${key}`)
  const run = async (action: ColdErasureAction) => {
    if (!ISOLATED_WORKSPACE_ENABLED || running.current || (action === 'local-only' && !armed && !localChosen)) return
    running.current = true; setArmed(false); setState('working')
    if (action === 'local-only') setLocalChosen(true)
    try {
      actor.current ??= (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure()
      await actor.current.resume(action); setState(action === 'cancel-not-sent' ? 'cancelled' : 'done')
    } catch { setState('failed') }
    finally { running.current = false }
  }
  const button = 'mt-4 min-h-11 rounded-lg border border-theme-border px-5 py-3 disabled:opacity-50'
  const effectiveMode = localChosen ? 'local-only' : mode
  const selectable = ['uncertain', 'not-sent', 'legacy-unknown'].includes(effectiveMode)
  const primary = effectiveMode === 'uncertain' ? 'verify' : 'resume'
  return <>
    <p className="mt-4 text-sm leading-relaxed text-theme-muted" role="status">{copy(!ISOLATED_WORKSPACE_ENABLED ? 'disabled' : state === 'idle' && selectable ? effectiveMode : state)}</p>
    {ISOLATED_WORKSPACE_ENABLED && (state === 'done' || state === 'cancelled'
      ? <button type="button" className={button} onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>
      : armed ? <>
        <p className="mt-4 text-sm" role="alert">{copy('localWarning')}</p>
        <button type="button" className={button} onClick={() => { void run('local-only') }}>{copy('confirmLocal')}</button>
        <button type="button" className={button} onClick={() => setArmed(false)}>{copy('back')}</button>
      </> : <div className="flex flex-col">
        {effectiveMode !== 'not-sent' && effectiveMode !== 'legacy-unknown' && <button type="button" disabled={state === 'working'} className={button} onClick={() => { void run(localChosen ? 'local-only' : 'resume') }}>{copy(primary)}</button>}
        {effectiveMode === 'not-sent' && <button type="button" disabled={state === 'working'} className={button} onClick={() => { void run('cancel-not-sent') }}>{copy('cancelNotSent')}</button>}
        {selectable && <button type="button" disabled={state === 'working'} className={button} onClick={() => setArmed(true)}>{copy('localOnly')}</button>}
      </div>)}
    {ISOLATED_WORKSPACE_ENABLED && state === 'failed' && <button type="button" className={button} onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>}
  </>
}
