import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISOLATED_WORKSPACE_ENABLED } from '../../services/workspaceWriter/activation'

/** No accounts, decrypted content, OAuth consumer or private App imports.
 * OFF is also enforced inside the writer, not merely on this button. */
export default function ColdMigrationRecovery({ erasure = false }: { erasure?: boolean }) {
  const { t } = useTranslation()
  const actor = useRef<{ resume(): Promise<unknown> }>()
  const running = useRef(false)
  const [state, setState] = useState<'idle' | 'working' | 'failed' | 'done'>('idle')
  const resume = async () => {
    if (!ISOLATED_WORKSPACE_ENABLED || running.current) return
    running.current = true; setState('working')
    try {
      actor.current ??= erasure
        ? (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure()
        : (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration()
      await actor.current.resume(); setState('done')
    } catch { setState('failed') }
    finally { running.current = false }
  }
  const section = erasure ? 'erasureRecovery' : 'recovery'
  return <>
    <p className="mt-4 text-sm leading-relaxed text-theme-muted" role="status">{t(`workspaceAdmission.${section}.${ISOLATED_WORKSPACE_ENABLED ? state : 'disabled'}`)}</p>
    {ISOLATED_WORKSPACE_ENABLED && (state === 'done'
      ? <button type="button" className="mt-6 min-h-11 rounded-lg bg-theme-ink px-5 py-3 text-theme-bg" onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>
      : <button type="button" disabled={state === 'working'} className="mt-6 min-h-11 rounded-lg bg-theme-ink px-5 py-3 text-theme-bg disabled:opacity-50" onClick={() => { void resume() }}>{t(`workspaceAdmission.${section}.resume`)}</button>)}
  </>
}
