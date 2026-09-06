import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISOLATED_WORKSPACE_ENABLED, WORKSPACE_UPGRADE_START_ENABLED } from '../../services/workspaceWriter/activation'
import { isNative } from '../../services/native/platform'

/** Local preparation only, never a promise of sync. A recovery stays available
 * after START rollback. Reload preserves the exact OAuth callback URL/state. */
export default function ColdWorkspaceUpgrade({ recovery = false }: { recovery?: boolean }) {
  const { t } = useTranslation(), chosen = useRef(false), mounted = useRef(true)
  const [state, setState] = useState<'choose' | 'working' | 'done' | 'failed'>('choose')
  const enabled = ISOLATED_WORKSPACE_ENABLED && (recovery || (WORKSPACE_UPGRADE_START_ENABLED && !isNative))
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = async () => {
    if (!enabled || chosen.current) return
    chosen.current = true; setState('working')
    try {
      const { createColdWorkspaceUpgrade } = await import('../../services/workspaceWriter/upgrade')
      if (!mounted.current) return
      await createColdWorkspaceUpgrade(recovery ? 'resume' : 'start').run()
      if (mounted.current) setState('done')
    } catch { if (mounted.current) setState('failed') }
  }
  const button = 'min-h-11 rounded-lg border border-theme-border px-5 py-3'
  return <div className="mt-5 space-y-4">
    <p role="status">{t(enabled ? `workspaceUpgrade.${state}` : 'workspaceUpgrade.disabled')}</p>
    {enabled && state === 'choose' && <button type="button" className={button} onClick={() => void run()}>{t(recovery ? 'workspaceUpgrade.resume' : 'workspaceUpgrade.start')}</button>}
    {state !== 'working' && (recovery
      ? <button type="button" className={button} onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>
      : <a className="block min-h-11 py-3 underline" href="/?start=1">{t('workspaceRestore.returnArty')}</a>)}
  </div>
}
