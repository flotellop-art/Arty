import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { StrictMode, createElement } from 'react'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { seedIsolatedWorkspace } from '../helpers/isolatedWorkspace'
import { deferred } from '../helpers/workspaceLocks'
import { getWorkspaceEntryRoute } from '../../services/workspaceWriter/entryRoute'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('react', async original => original())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../services/native/platform', () => ({ isNative: false }))
const policy = vi.hoisted(() => ({ start: true }))
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true,
  get WORKSPACE_UPGRADE_START_ENABLED() { return policy.start } }))
let runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
async function newDocument() {
  cleanup()
  if (runtime?.documentWorkspace.getSnapshot() === 'held') { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
  vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(_n: unknown, _o: unknown, callback: (v: unknown) => Promise<void>) { void callback({}); return lock.promise },
  } })
  runtime = await import('../../services/workspaceWriter/runtime'); await runtime.documentWorkspace.acquire()
}
const root = async () => { const db = await openDB('arty-workspace-control'); try { return await db.get('meta', 'workspace') } finally { db.close() } }
async function mount(upgrade = false) {
  const { DocumentWorkspaceGate } = await import('../../components/workspace/DocumentWorkspaceGate')
  const Content = vi.fn(() => <div>private-app</div>)
  render(<StrictMode>{createElement(DocumentWorkspaceGate, { upgrade, Content })}</StrictMode>)
  return Content
}
beforeEach(async () => {
  vi.restoreAllMocks(); policy.start = true; globalThis.indexedDB = new IDBFactory(); localStorage.clear(); sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') }))
  await newDocument(); await seedIsolatedWorkspace()
})
afterEach(async () => { cleanup(); lock.resolve(); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

it('disabled explicit cold route never admits, changes storage, or imports private Content', async () => {
  policy.start = false; const before = await root()
  const get = vi.fn(() => null)
  expect(getWorkspaceEntryRoute('/workspace/upgrade', '', false, false, { getItem: get })).toBe('workspace-upgrade')
  expect(get).not.toHaveBeenCalled()
  const Content = await mount(true)
  await screen.findByText('workspaceUpgrade.disabled')
  expect(screen.queryByRole('button')).toBeNull(); expect(Content).not.toHaveBeenCalled()
  expect(runtime.workspaceAdmission.getSnapshot()).toBe('idle'); expect(await root()).toEqual(before)
})

it('StrictMode double click starts once; completion still requires a new document', async () => {
  const module = await import('../../services/workspaceWriter/upgrade'), start = vi.spyOn(module, 'createColdWorkspaceUpgrade')
  const Content = await mount(true)
  const button = await screen.findByRole('button', { name: 'workspaceUpgrade.start' })
  await act(async () => { fireEvent.click(button); fireEvent.click(button) })
  await screen.findByText('workspaceUpgrade.done')
  expect(start).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledWith('start')
  expect((await root()).projectsVersion).toBe(2); expect(Content).not.toHaveBeenCalled()
  expect(runtime.workspaceAdmission.getSnapshot()).toBe('maintenance')
  expect(screen.getByRole('link', { name: 'workspaceRestore.returnArty' })).toHaveAttribute('href', '/?start=1')
  await newDocument(); await mount(); await screen.findByText('private-app')
})

it('real interrupted upgrade resumes with START OFF, keeps OAuth callback and never imports App in that document', async () => {
  const put = IDBObjectStore.prototype.put
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control' && value.projectsVersion === 2) throw new Error('cut before final')
    return put.call(this, value, key)
  })
  await expect((await import('../../services/workspaceWriter/upgrade')).createColdWorkspaceUpgrade('start').run()).rejects.toThrow()
  fault.mockRestore(); policy.start = false; await newDocument()
  window.history.replaceState({}, '', '/auth/callback?code=synthetic&state=exact#fragment'); sessionStorage.setItem('synthetic-verifier', 'keep')
  const href = location.href, Content = await mount()
  fireEvent.click(await screen.findByRole('button', { name: 'workspaceUpgrade.resume' }))
  await screen.findByText('workspaceUpgrade.done')
  expect(screen.getByRole('button', { name: 'workspaceWindow.reload' })).toBeVisible()
  expect(location.href).toBe(href); expect(sessionStorage.getItem('synthetic-verifier')).toBe('keep')
  expect(Content).not.toHaveBeenCalled(); expect(runtime.workspaceAdmission.getSnapshot()).toBe('maintenance')
  expect(fetch).not.toHaveBeenCalled()
})

it('unmount while the actor import is pending never starts a late upgrade', async () => {
  const entered = deferred(), release = deferred(), finished = deferred(), start = vi.fn()
  const before = await root()
  vi.doMock('../../services/workspaceWriter/upgrade', async () => {
    entered.resolve(); await release.promise
    finished.resolve(); return { createColdWorkspaceUpgrade: start }
  })
  try {
    const Content = await mount(true)
    fireEvent.click(await screen.findByRole('button', { name: 'workspaceUpgrade.start' }))
    await entered.promise; cleanup()
    await act(async () => { release.resolve(); await finished.promise })
    expect(start).not.toHaveBeenCalled(); expect(Content).not.toHaveBeenCalled()
    expect(runtime.workspaceAdmission.getSnapshot()).toBe('idle'); expect(await root()).toEqual(before)
  } finally { release.resolve(); vi.doUnmock('../../services/workspaceWriter/upgrade') }
})
