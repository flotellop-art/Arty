import { StrictMode, useEffect, lazy } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentWorkspaceGate } from '../../components/workspace/DocumentWorkspaceGate'
import { createDocumentWorkspaceLock } from '../../services/workspaceWriter/documentLock'
import { createWorkspaceAdmission } from '../../services/workspaceWriter/admission'
import { LEGACY_WORKSPACE_LAYOUT } from '../../services/workspaceWriter/layout'
import { deferred, sharedWorkspaceLocks } from '../helpers/workspaceLocks'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); localStorage.clear(); sessionStorage.clear() })
const admissionFor = (controller: ReturnType<typeof createDocumentWorkspaceLock>) => createWorkspaceAdmission(
  { assertLock: () => controller.assertHeld(), signal: controller.signal }, async () => LEGACY_WORKSPACE_LAYOUT,
)

describe('workspace gate is before any private hooks/import/seed', () => {
  it('recognized migration stays cold with OFF recovery, no reload loop and exact OAuth callback preservation', async () => {
    const db = await openDB('arty-workspace-control', 1, { upgrade(db) { db.createObjectStore('meta') } })
    await db.put('meta', { format: 'arty-workspace-control', version: 3, layout: 'legacy-v1', state: 'migration', revision: 3,
      generation: '76ba201a-547f-44a1-9000-111111111111', phase: 'inventoried' }, 'workspace'); db.close()
    const controller = createDocumentWorkspaceLock(() => sharedWorkspaceLocks().source)
    const admission = createWorkspaceAdmission({ assertLock: () => controller.assertHeld(), signal: controller.signal })
    window.history.replaceState({}, '', '/auth/callback?code=synthetic&state=exact#fragment')
    sessionStorage.setItem('synthetic-verifier', 'keep'); const href = window.location.href
    const loaded = vi.fn(async () => ({ default: () => <div>private</div> })), Content = lazy(loaded)
    render(<DocumentWorkspaceGate controller={controller} admission={admission} Content={Content} />)
    await screen.findByText('workspaceAdmission.recovery.disabled')
    expect(screen.queryAllByRole('button')).toHaveLength(0); expect(loaded).not.toHaveBeenCalled()
    expect(window.location.href).toBe(href); expect(sessionStorage.getItem('synthetic-verifier')).toBe('keep')
  })
  it('StrictMode never loads private Content while the single cold read is pending', async () => {
    const locks = sharedWorkspaceLocks(), controller = createDocumentWorkspaceLock(() => locks.source), gate = deferred()
    const read = vi.fn(async () => { await gate.promise; return LEGACY_WORKSPACE_LAYOUT })
    const admission = createWorkspaceAdmission({ assertLock: () => controller.assertHeld(), signal: controller.signal }, read)
    const loaded = vi.fn(async () => ({ default: () => <div>private-ready</div> })), Content = lazy(loaded)
    const view = render(<StrictMode><DocumentWorkspaceGate controller={controller} admission={admission} Content={Content} /></StrictMode>)
    await screen.findByText('workspaceAdmission.checkingTitle')
    expect(loaded).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce()
    view.unmount()
    render(<DocumentWorkspaceGate controller={controller} admission={admission} Content={Content} />)
    expect(loaded).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce()
    await act(async () => { gate.resolve() })
    await screen.findByText('private-ready'); expect(loaded).toHaveBeenCalledOnce()
  })

  it.each(['corrupt', 'incompatible', 'maintenance', 'unavailable'] as const)('real IDB %s blocks lazy import and preserves exact OAuth return with only cold reload', async failure => {
    if (failure === 'unavailable') vi.stubGlobal('indexedDB', undefined)
    else {
      const db = await openDB('arty-workspace-control', 1, { upgrade(db) { db.createObjectStore('meta') } })
      if (failure !== 'corrupt') await db.put('meta', { format: 'arty-workspace-control', version: failure === 'incompatible' ? 2 : 1, layout: 'legacy-v1', revision: 1, state: 'maintenance' }, 'workspace')
      db.close()
    }
    const controller = createDocumentWorkspaceLock(() => sharedWorkspaceLocks().source)
    const admission = createWorkspaceAdmission({ assertLock: () => controller.assertHeld(), signal: controller.signal })
    window.history.replaceState({}, '', '/auth/callback?code=synthetic-code&state=synthetic-state#synthetic-hash')
    const href = window.location.href
    sessionStorage.setItem('synthetic-oauth-state', 'keep'); sessionStorage.setItem('synthetic-verifier', 'keep')
    const loaded = vi.fn(async () => ({ default: () => <div>private-ready</div> })), Content = lazy(loaded)
    const view = render(<DocumentWorkspaceGate controller={controller} admission={admission} Content={Content} />)
    await screen.findByText(`workspaceAdmission.${failure}Title`)
    expect(loaded).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'workspaceWindow.reload' })).toBeInTheDocument()
    expect(screen.queryByText('workspaceWindow.retry')).toBeNull()
    expect(screen.getByRole('link', { name: 'workspaceWindow.discover' })).toHaveAttribute('href', '/discover')
    expect(screen.getByRole('link', { name: 'landing.footer.privacy' })).toHaveAttribute('href', '/privacy/')
    view.unmount(); render(<DocumentWorkspaceGate controller={controller} admission={admission} Content={Content} />)
    await screen.findByText(`workspaceAdmission.${failure}Title`)
    expect(window.location.href).toBe(href)
    expect(sessionStorage.getItem('synthetic-oauth-state')).toBe('keep'); expect(sessionStorage.getItem('synthetic-verifier')).toBe('keep')
    expect(localStorage.length).toBe(0); expect(loaded).not.toHaveBeenCalled()
  })

  it('losing the document during a pending cold read never imports the late result', async () => {
    const request = deferred(), gate = deferred()
    const controller = createDocumentWorkspaceLock(() => ({ request(_name, _options, callback) { void callback({}); return request.promise } }))
    const read = vi.fn(async () => { await gate.promise; return LEGACY_WORKSPACE_LAYOUT })
    const admission = createWorkspaceAdmission({ assertLock: () => controller.assertHeld(), signal: controller.signal }, read)
    const loaded = vi.fn(async () => ({ default: () => <div>private-ready</div> })), Content = lazy(loaded)
    render(<DocumentWorkspaceGate controller={controller} admission={admission} Content={Content} />)
    await screen.findByText('workspaceAdmission.checkingTitle')
    await act(async () => { request.reject(new Error('lost')) })
    await screen.findByText('workspaceWindow.lostTitle')
    await act(async () => { gate.resolve() })
    expect(admission.getSnapshot()).toBe('lost'); expect(loaded).not.toHaveBeenCalled()
  })

  it('StrictMode setup-cleanup-setup reserves once and never releases on unmount', async () => {
    const locks = sharedWorkspaceLocks(), controller = createDocumentWorkspaceLock(() => locks.source)
    const admission = admissionFor(controller)
    const loaded = vi.fn(async () => ({ default: () => <div>private-ready</div> })), Content = lazy(loaded)
    const view = render(<StrictMode><DocumentWorkspaceGate controller={controller} admission={admission} Content={Content} /></StrictMode>)
    await screen.findByText('private-ready'); expect(loaded).toHaveBeenCalledOnce()
    view.unmount(); expect(locks.held.size).toBe(1)
    render(<StrictMode><DocumentWorkspaceGate controller={controller} admission={admission} Content={Content} /></StrictMode>)
    await screen.findByText('private-ready'); expect(locks.requested).toHaveLength(1)
  })

  it('busy OAuth return never imports Content or consumes the URL/state/verifier; retry reads fresh', async () => {
    const locks = sharedWorkspaceLocks(), a = createDocumentWorkspaceLock(() => locks.source), b = createDocumentWorkspaceLock(() => locks.source)
    await a.acquire()
    window.history.replaceState({}, '', '/auth/callback?code=synthetic-code&state=synthetic-state')
    sessionStorage.setItem('synthetic-oauth-state', 'keep'); sessionStorage.setItem('synthetic-verifier', 'keep')
    localStorage.setItem('synthetic-history', 'before')
    const loaded = vi.fn(async () => ({ default: () => <div>{localStorage.getItem('synthetic-history')}</div> })), Content = lazy(loaded)
    render(<DocumentWorkspaceGate controller={b} admission={admissionFor(b)} Content={Content} />)
    await screen.findByText('workspaceWindow.busyTitle')
    fireEvent.click(screen.getByText('workspaceWindow.retry')); await waitFor(() => expect(locks.requested).toHaveLength(3))
    await screen.findByText('workspaceWindow.busyTitle')
    expect(loaded).not.toHaveBeenCalled(); expect(window.location.search).toBe('?code=synthetic-code&state=synthetic-state')
    expect(sessionStorage.getItem('synthetic-oauth-state')).toBe('keep'); expect(sessionStorage.getItem('synthetic-verifier')).toBe('keep')
    localStorage.setItem('synthetic-history', 'latest-durable')
    locks.held.clear() // browser destruction simulation only
    fireEvent.click(screen.getByText('workspaceWindow.retry'))
    await screen.findByText('latest-durable'); expect(loaded).toHaveBeenCalledOnce()
    window.history.replaceState({}, '', '/'); sessionStorage.clear(); localStorage.clear()
  })

  it('without Web Locks shows a distinct explanation and never mounts private effects', async () => {
    const opened = vi.fn(), controller = createDocumentWorkspaceLock(() => undefined)
    function Content() { useEffect(opened, []); return <div>private-ready</div> }
    render(<DocumentWorkspaceGate controller={controller} admission={admissionFor(controller)} Content={Content} />)
    await screen.findByText('workspaceWindow.unsupportedTitle')
    expect(opened).not.toHaveBeenCalled(); expect(screen.queryByText('workspaceWindow.retry')).toBeNull()
    expect(screen.getByText('workspaceWindow.discover')).toHaveAttribute('href', '/discover')
  })

  it('keeps its grant after a failed lazy import; private failure does not allow another writer', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const locks = sharedWorkspaceLocks(), controller = createDocumentWorkspaceLock(() => locks.source)
    const Content = lazy(async () => { throw new Error('synthetic chunk failure') })
    render(<DocumentWorkspaceGate controller={controller} admission={admissionFor(controller)} Content={Content} />)
    await screen.findByText('workspaceWindow.loadFailedTitle')
    expect(screen.getByRole('button', { name: 'workspaceWindow.reload' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull()
    expect(controller.getSnapshot()).toBe('held')
    expect(await createDocumentWorkspaceLock(() => locks.source).acquire()).toBe('busy')
    errors.mockRestore()
  })

  it('exceptional lock loss removes private effects and allows only cold reload, not re-acquisition', async () => {
    const request = deferred(), cleanupEffect = vi.fn()
    const controller = createDocumentWorkspaceLock(() => ({ request(_name, _options, callback) { void callback({}); return request.promise } }))
    function Content() { useEffect(() => cleanupEffect, []); return <div>private-ready</div> }
    render(<DocumentWorkspaceGate controller={controller} admission={admissionFor(controller)} Content={Content} />)
    await screen.findByText('private-ready')
    await act(async () => { request.reject(new Error('lost')) })
    await screen.findByText('workspaceWindow.lostTitle'); expect(cleanupEffect).toHaveBeenCalledOnce()
    expect(screen.queryByText('private-ready')).toBeNull(); expect(screen.queryByText('workspaceWindow.retry')).toBeNull()
  })
})
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
