import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ISOLATED_WORKSPACE_ENABLED, WORKSPACE_RESTORE_START_ENABLED } from '../../services/workspaceWriter/activation'
import { isNative } from '../../services/native/platform'

/** Mounted with the document lock, BEFORE admission. Never mount private App
 * in this document, including after success or cancellation. */
export default function ColdWorkspaceSetup() {
  const { t } = useTranslation(), chosen = useRef(false), mounted = useRef(true)
  const [state, setState] = useState<'consent' | 'working' | 'done' | 'failed'>('consent')
  const enabled = ISOLATED_WORKSPACE_ENABLED && WORKSPACE_RESTORE_START_ENABLED
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const start = async () => {
    if (!enabled || isNative || chosen.current) return
    chosen.current = true; setState('working')
    try {
      const { createColdWorkspaceMigration } = await import('../../services/workspaceWriter/migration')
      if (!mounted.current) return
      await createColdWorkspaceMigration().start()
      if (mounted.current) setState('done')
    } catch { if (mounted.current) setState('failed') }
  }
  return <main className="min-h-[100dvh] bg-theme-bg px-6 py-12 text-theme-ink">
    <section className="mx-auto max-w-lg space-y-5">
      <h1 className="font-display text-2xl">{t('workspaceRestore.setupTitle')}</h1>
      <p role="status">{t(isNative ? 'workspaceRestore.nativeUnavailable' : enabled ? `workspaceRestore.setup.${state}` : 'workspaceRestore.disabled')}</p>
      {state === 'consent' && enabled && !isNative && <>
        <p>{t('workspaceRestore.setupConsent')}</p>
        <button type="button" className="min-h-11 rounded-lg bg-theme-ink px-5 py-3 text-theme-bg" onClick={() => void start()}>{t('workspaceRestore.setupStart')}</button>
      </>}
      {state !== 'working' && <a className="block min-h-11 py-3 underline" href="/?start=1">{t('workspaceRestore.returnArty')}</a>}
    </section>
  </main>
}
