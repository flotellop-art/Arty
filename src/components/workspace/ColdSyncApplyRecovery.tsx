import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspaceAdmission } from '../../services/workspaceWriter/runtime'

export default function ColdSyncApplyRecovery() {
  const { t } = useTranslation(), chosen = useRef(false), mounted = useRef(true)
  const [state, setState] = useState<'choose' | 'confirmAbort' | 'confirmErase' | 'working' | 'done' | 'erasureReserved' | 'failed'>('choose')
  const header = workspaceAdmission.getSyncApplyRecovery(), aborting = header?.apply.phase === 'aborting', update = header?.version === 11
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = async (action: 'resume' | 'abort' | 'eraseLocal') => {
    if (chosen.current) return
    chosen.current = true; setState('working')
    try {
      const { createColdWorkspaceSyncApply } = await import('../../services/workspaceWriter/syncApply')
      if (!mounted.current) return
      await createColdWorkspaceSyncApply()[action]()
      if (mounted.current) setState(action === 'eraseLocal' ? 'erasureReserved' : 'done')
    } catch { if (mounted.current) setState('failed') }
  }
  const button = 'min-h-11 rounded-lg border border-theme-border px-5 py-3'
  return <div className="mt-5 space-y-4">
    <p role={state.startsWith('confirm') ? 'alert' : 'status'}>{t(update && (state === 'choose' || state === 'confirmAbort') ? `workspaceSyncApply.update.${state}` : `workspaceSyncApply.cold.${state}`)}</p>
    {state === 'choose' && <div className="flex flex-wrap justify-center gap-3">
      {!aborting && <button className={button} onClick={() => void run('resume')}>{t('workspaceSyncApply.resume')}</button>}
      <button className={button} onClick={() => setState('confirmAbort')}>{t('workspaceSyncApply.abort')}</button>
      <button className={button} onClick={() => setState('confirmErase')}>{t('workspaceSyncApply.erase')}</button>
    </div>}
    {state.startsWith('confirm') && <div className="flex flex-wrap justify-center gap-3">
      <button className={button} onClick={() => void run(state === 'confirmErase' ? 'eraseLocal' : 'abort')}>{t('workspaceSyncApply.confirm')}</button>
      <button className={button} onClick={() => setState('choose')}>{t('common.cancel')}</button>
    </div>}
    {state !== 'working' && <button className={button} onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>}
    <a className="block min-h-11 py-3 underline" href="/privacy/">{t('landing.footer.privacy')}</a>
  </div>
}
