import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISOLATED_WORKSPACE_ENABLED } from '../../services/workspaceWriter/activation'
import { workspaceAdmission } from '../../services/workspaceWriter/runtime'

export default function ColdRestoreRecovery() {
  const { t } = useTranslation(), chosen = useRef(false), mounted = useRef(true)
  const [state, setState] = useState<'choose' | 'confirmAbort' | 'working' | 'done' | 'failed'>('choose')
  const aborting = workspaceAdmission.getRestoreRecovery()?.restore.phase === 'aborting'
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = async (action: 'resume' | 'abort') => {
    if (!ISOLATED_WORKSPACE_ENABLED || chosen.current) return
    chosen.current = true; setState('working')
    try {
      const { createColdWorkspaceRestore } = await import('../../services/workspaceWriter/restore')
      if (!mounted.current) return
      await createColdWorkspaceRestore()[action]()
      if (mounted.current) setState('done')
    } catch { if (mounted.current) setState('failed') }
  }
  const button = 'min-h-11 rounded-lg border border-theme-border px-5 py-3'
  return <div className="mt-5 space-y-4">
    <p role="status">{t(ISOLATED_WORKSPACE_ENABLED ? `workspaceRestore.recovery.${state}` : 'workspaceRestore.disabled')}</p>
    {ISOLATED_WORKSPACE_ENABLED && state === 'choose' && <div className="flex flex-wrap justify-center gap-3">
      {!aborting && <button className={button} onClick={() => void run('resume')}>{t('workspaceRestore.resume')}</button>}
      <button className={button} onClick={() => setState('confirmAbort')}>{t(aborting ? 'workspaceRestore.continueAbort' : 'workspaceRestore.reviewAbort')}</button>
    </div>}
    {ISOLATED_WORKSPACE_ENABLED && state === 'confirmAbort' && <button className={button} onClick={() => void run('abort')}>{t('workspaceRestore.confirmAbort')}</button>}
    {state !== 'working' && <a className="block min-h-11 py-3 underline" href="/?start=1">{t('workspaceRestore.returnArty')}</a>}
  </div>
}
