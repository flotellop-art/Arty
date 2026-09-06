import { lazy, Suspense, useEffect, useSyncExternalStore, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { documentWorkspace, workspaceAdmission, assertDocumentWorkspace } from '../../services/workspaceWriter/runtime'
import type { createDocumentWorkspaceLock } from '../../services/workspaceWriter/documentLock'
import type { createWorkspaceAdmission } from '../../services/workspaceWriter/admission'
import { ErrorBoundary } from '../shared/ErrorBoundary'

/** Import/seeding is INSIDE the held branch, not a static App dependency.
 * React.lazy memoizes the loader across StrictMode's setup/cleanup/setup. */
const PrivateApp = lazy(async () => {
  assertDocumentWorkspace()
  if (__DEMO_ALLOWED__) {
    const demo = await import('../../services/previewDemo')
    assertDocumentWorkspace()
    demo.setupPreviewDemo()
  }
  assertDocumentWorkspace()
  const app = await import('../../App')
  assertDocumentWorkspace()
  return app
})
const ColdMigrationRecovery = lazy(() => import('./ColdMigrationRecovery'))
const ColdRestoreRecovery = lazy(() => import('./ColdRestoreRecovery'))
const ColdWorkspaceSetup = lazy(() => import('./ColdWorkspaceSetup'))

type Controller = ReturnType<typeof createDocumentWorkspaceLock>
export function DocumentWorkspaceGate({ controller = documentWorkspace, admission = workspaceAdmission, Content = PrivateApp, setup = false }: {
  controller?: Controller; admission?: ReturnType<typeof createWorkspaceAdmission>; Content?: ComponentType; setup?: boolean
}) {
  const { t } = useTranslation()
  const phase = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => { void controller.acquire() }, [controller]) // no cleanup release
  if (phase === 'held') return <ErrorBoundary fallback={<WorkspaceBootFailure />}>{setup
    ? <Suspense fallback={<Wait title={t('workspaceWindow.loading')} />}><ColdWorkspaceSetup /></Suspense>
    : <StorageAdmissionGate admission={admission} Content={Content} />}</ErrorBoundary>
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

function StorageAdmissionGate({ admission, Content }: { admission: ReturnType<typeof createWorkspaceAdmission>; Content: ComponentType }) {
  const { t } = useTranslation()
  const phase = useSyncExternalStore(admission.subscribe, admission.getSnapshot, admission.getSnapshot)
  useEffect(() => { void admission.admit() }, [admission])
  if (phase === 'ready') return <Suspense fallback={<Wait title={t('workspaceWindow.loading')} />}><Content /></Suspense>
  if ((phase === 'restoring' || phase === 'maintenance') && admission.getRestoreRecovery()) return <Wait title={t('workspaceRestore.recoveryTitle')}>
    <Suspense fallback={null}><ColdRestoreRecovery /></Suspense>
  </Wait>
  if ((phase === 'erasure' || phase === 'maintenance') && admission.hasErasureRecovery()) return <Wait title={t('workspaceAdmission.erasureTitle')}>
    <Suspense fallback={null}><ColdMigrationRecovery erasure mode={admission.getErasureMode()} /></Suspense>
    <a className="mt-6 inline-flex min-h-11 items-center px-4 text-sm underline" href="/privacy/">{t('landing.footer.privacy')}</a>
  </Wait>
  if ((phase === 'recoverable' || phase === 'maintenance') && admission.getRecovery()) return <Wait title={t('workspaceAdmission.recoverableTitle')}>
    <Suspense fallback={null}><ColdMigrationRecovery /></Suspense>
    <a className="mt-6 inline-flex min-h-11 items-center px-4 text-sm underline" href="/privacy/">{t('landing.footer.privacy')}</a>
  </Wait>
  const checking = phase === 'idle' || phase === 'checking'
  const key = checking ? 'checking' : phase
  return <Wait title={t(`workspaceAdmission.${key}Title`)}>
    <p className="mt-4 text-sm leading-relaxed text-theme-muted">{t(`workspaceAdmission.${key}Body`)}</p>
    {!checking && <button type="button" className="mt-6 min-h-11 rounded-lg bg-theme-ink px-5 py-3 font-semibold text-theme-bg" onClick={() => window.location.reload()}>{t('workspaceWindow.reload')}</button>}
    <a className="mt-6 inline-flex min-h-11 items-center px-4 text-sm underline" href="/discover">{t('workspaceWindow.discover')}</a>
    <a className="mt-6 inline-flex min-h-11 items-center px-4 text-sm underline" href="/privacy/">{t('landing.footer.privacy')}</a>
  </Wait>
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
