import { lazy, Suspense, useEffect, useSyncExternalStore, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { documentWorkspace } from '../../services/workspaceWriter/runtime'
import type { createDocumentWorkspaceLock } from '../../services/workspaceWriter/documentLock'
import { ErrorBoundary } from '../shared/ErrorBoundary'

/** Import/seeding is INSIDE the held branch, not a static App dependency.
 * React.lazy memoizes the loader across StrictMode's setup/cleanup/setup. */
const PrivateApp = lazy(async () => {
  if (__DEMO_ALLOWED__) {
    const demo = await import('../../services/previewDemo')
    documentWorkspace.assertHeld()
    demo.setupPreviewDemo()
  }
  documentWorkspace.assertHeld()
  const app = await import('../../App')
  documentWorkspace.assertHeld()
  return app
})

type Controller = ReturnType<typeof createDocumentWorkspaceLock>
export function DocumentWorkspaceGate({ controller = documentWorkspace, Content = PrivateApp }: {
  controller?: Controller; Content?: ComponentType
}) {
  const { t } = useTranslation()
  const phase = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => { void controller.acquire() }, [controller]) // no cleanup release
  if (phase === 'held') return <ErrorBoundary fallback={<WorkspaceBootFailure />}><Suspense fallback={<Wait title={t('workspaceWindow.loading')} />}><Content /></Suspense></ErrorBoundary>
  const checking = phase === 'idle' || phase === 'acquiring'
  const key = checking ? 'checking' : phase
  return (
    <Wait title={t(`workspaceWindow.${key}Title`)}>
      <p className="mt-4 text-sm leading-relaxed text-theme-muted">{t(`workspaceWindow.${key}Body`)}</p>
      {!checking && <div className="mt-6 flex flex-wrap justify-center gap-3">
        {phase === 'busy' || phase === 'failed' ? (
          <button type="button" className="min-h-11 rounded-lg bg-theme-ink px-5 py-3 font-semibold text-theme-bg" onClick={() => { void controller.acquire() }}>{t('workspaceWindow.retry')}</button>
        ) : phase === 'lost' ? (
          <button type="button" className="min-h-11 rounded-lg bg-theme-ink px-5 py-3 font-semibold text-theme-bg" onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>
        ) : null}
        <a className="inline-flex min-h-11 items-center rounded-lg border border-theme-border px-5 py-3" href="/discover">{t('workspaceWindow.discover')}</a>
      </div>}
      <a className="mt-6 inline-flex min-h-11 items-center text-sm underline" href="/privacy/">{t('landing.footer.privacy')}</a>
    </Wait>
  )
}

export function WorkspaceBootFailure() {
  const { t } = useTranslation()
  return <Wait title={t('workspaceWindow.loadFailedTitle')}>
    <p className="mt-4 text-sm leading-relaxed text-theme-muted">{t('workspaceWindow.loadFailedBody')}</p>
    <button type="button" className="mt-6 min-h-11 rounded-lg bg-theme-ink px-5 py-3 font-semibold text-theme-bg" onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>
  </Wait>
}

function Wait({ title, children }: { title: string; children?: React.ReactNode }) {
  return <main className="flex min-h-[100dvh] items-center justify-center bg-theme-bg px-6 py-10 text-theme-ink">
    <section className="w-full max-w-lg text-center" aria-live="polite">
      <p className="mb-6 font-display text-xl text-theme-ink">Arty</p>
      <h1 className="font-display text-2xl">{title}</h1>
      {children}
    </section>
  </main>
}
