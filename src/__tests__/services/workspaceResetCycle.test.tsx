import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { File as NodeFile } from 'node:buffer'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/workspaceLocks'
import { workspaceDataKey } from '../../services/workspaceWriter/layout'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('react', async original => original()) // one React identity across simulated cold documents
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }))
const native = vi.hoisted(() => ({ reopen: vi.fn(async () => {}) }))
vi.mock('../../services/native/coldMailErasure', async original => ({ ...await original<typeof import('../../services/native/coldMailErasure')>(), reopenColdMailScope: native.reopen }))
let runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
const account = (userId: string) => ({ userId, authMethod: 'apikey' as const, displayName: 'Synthetic', createdAt: 1 })
async function endDocument() {
  cleanup()
  if (runtime?.documentWorkspace.getSnapshot() === 'held') { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request(_n: unknown, _o: unknown, cb: (v: unknown) => Promise<void>) { void cb({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime'); await runtime.documentWorkspace.acquire()
}
async function control() { const db = await openDB('arty-workspace-control'); try { return await db.get('meta', 'workspace') } finally { db.close() } }
async function cold() {
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('erasure')
  await (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure().resume()
  expect((await control()).version).toBe(7)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
}
async function writeAndRead(label: string) {
  const projects = await import('../../services/projects/store'), files = await import('../../services/secureFileStorage'), history = await import('../../services/storage')
  await history.bootstrapConversationStorage(); await files.bootstrapFileStorage()
  const op = await projects.beginProjectOperation()
  let p = await projects.createProject(op, label)
  const prepared = await (await import('../../services/projects/documentImport')).prepareProjectDocument(op, new NodeFile([label], `${label}.txt`, { type: 'text/plain' }) as unknown as File)
  p = await projects.addProjectDocument(op, p, prepared)
  await files.putFile({ id: label, name: `${label}.txt`, type: 'text/plain', size: 1, data: 'QQ==' })
  const conversation = { id: label, title: label, createdAt: 1, updatedAt: 1, messages: [{ id: label, role: 'user' as const, content: label, timestamp: 1 }] }
  history.saveConversation(conversation)
  await vi.waitFor(() => expect(history.getConversation(label)).toEqual(conversation))
  const users = await import('../../services/userSession')
  const layout = runtime.getDocumentStorageLayout()
  await vi.waitFor(() => expect(localStorage.getItem(workspaceDataKey(layout, users.getActiveUserId(), 'conversations'))).toBeNull())
  expect((await files.getFile(label))?.data).toBe('QQ==')
  expect(await projects.getProject(op, p.id)).toMatchObject({ status: 'ready', project: p })
  return { id: p.id, label }
}
async function readAndUpdate(saved: { id: string; label: string }) {
  const projects = await import('../../services/projects/store'), files = await import('../../services/secureFileStorage'), history = await import('../../services/storage')
  await history.bootstrapConversationStorage(); await files.bootstrapFileStorage()
  expect(history.getConversation(saved.label)?.title).toBe(saved.label)
  expect((await files.getFile(saved.label))?.data).toBe('QQ==')
  const op = await projects.beginProjectOperation(), result = await projects.getProject(op, saved.id)
  expect(result.status).toBe('ready')
  if (result.status !== 'ready') throw new Error('synthetic fixture')
  const updated = await projects.updateProject(op, result.project, { name: `${saved.label} updated` })
  expect(await projects.getProject(op, saved.id)).toMatchObject({ status: 'ready', project: updated })
}
async function prepare(migratedA = true) {
  expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  let users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
  const a = await users.generateUserId('apikey', 'new-key-a'), b = `${a}-b`
  users.setActiveSession(account(b)); await crypt.initCrypto('key-b'); const savedB = await writeAndRead('B')
  if (migratedA) { users.setActiveSession(account(a)); await crypt.initCrypto('old-key-a'); await writeAndRead('old-A') }
  await newDocument(); const layout = await (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().start()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
  users.setActiveSession(account(a))
  await crypt.initCrypto('old-key-a')
  if (!migratedA) await writeAndRead('old-A')
  const oldSalt = localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt'))
  return { a, b, layout, savedB, oldSalt }
}
async function handoff() {
  expect(await (await import('../../services/accountService')).wipeLocalAccount()).toBe('reload-required')
}
async function explicit(a: string, passphrase = 'new-key-a') {
  const users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
  users.setActiveSession(account(a), { remember: false })
  const epoch = users.getActiveSessionEpoch()
  await crypt.initLoginCrypto(passphrase, () => { if (users.getActiveUserId() !== a || users.getActiveSessionEpoch() !== epoch) throw new Error('superseded') })
  return { users, crypt }
}
beforeEach(async () => {
  vi.restoreAllMocks(); native.reopen.mockReset().mockResolvedValue(); localStorage.clear(); sessionStorage.clear(); globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') })); await newDocument()
})
afterEach(async () => { await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([true, false])('actual button → cold document → real login → two reset cycles; migrated A=%s, B reads AND writes', async migrated => {
  const { a, b, savedB, oldSalt, layout } = await prepare(migrated)
  const service = await import('../../services/accountService'), handoffSpy = vi.spyOn(service, 'wipeLocalAccount')
  const { AccountDeletionPanel } = await import('../../components/settings/AccountDeletionPanel')
  const { DocumentWorkspaceGate } = await import('../../components/workspace/DocumentWorkspaceGate')
  const done = vi.fn(); render(createElement(DocumentWorkspaceGate, { controller: runtime.documentWorkspace, admission: runtime.workspaceAdmission,
    Content: () => createElement(AccountDeletionPanel, { open: true, onComplete: done }) }))
  fireEvent.click(await screen.findByText('account.localChoice'))
  await act(async () => {
    fireEvent.click(screen.getByText('account.localConfirm'))
    await vi.waitFor(() => expect(handoffSpy).toHaveResolvedWith('reload-required'))
  })
  expect(done).not.toHaveBeenCalled()
  expect(runtime.documentWorkspace.getSnapshot()).toBe('lost')
  expect(screen.getByText('workspaceWindow.reload')).toBeVisible()
  expect(() => runtime.assertDocumentWorkspace()).toThrow()
  expect(() => runtime.workspaceAdmission.claimMaintenance()).toThrow()
  const active = await openDB(layout.projects.name); expect(await active.get('meta', ['erasing', a])).toMatchObject({ localOnly: true }); active.close()
  await cold()
  const first = (await control()).resets.find((r: { owner: string }) => r.owner === a)
  expect(first.phase).toBe('available')
  let users = await import('../../services/userSession'); users.clearActiveSession()
  const { useAuth } = await import('../../hooks/useAuth'), auth = renderHook(() => useAuth())
  await act(async () => { await auth.result.current.login('apikey', { identifier: 'new-key-a', anthropicKey: 'new-key-a', displayName: 'Fresh A' }) })
  expect(auth.result.current.currentUser?.userId).toBe(a)
  const salt1 = localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt'))
  expect(salt1).not.toBe(oldSalt); expect((await control()).resets[0]).toMatchObject({ ...first, phase: 'consumed' })
  const savedA = await writeAndRead('fresh-A')
  auth.unmount(); await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  users = await import('../../services/userSession'); let crypt = await import('../../services/crypto')
  users.setActiveSession(account(a)); await crypt.initCrypto('new-key-a'); await readAndUpdate(savedA)
  users.setActiveSession(account(b)); await crypt.initCrypto('key-b'); await readAndUpdate(savedB)
  users.setActiveSession(account(a)); await crypt.initCrypto('new-key-a'); await handoff(); await cold()
  const second = (await control()).resets.find((r: { owner: string }) => r.owner === a)
  expect(second.resetId).not.toBe(first.resetId)
  await explicit(a); expect(localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt'))).not.toBe(salt1)
  users = await import('../../services/userSession'); users.rememberSession(account(a)); await writeAndRead('second-A')
  users.setActiveSession(account(b)); crypt = await import('../../services/crypto'); await crypt.initCrypto('key-b'); await readAndUpdate(savedB)
  expect(fetch).not.toHaveBeenCalled()
}, 30_000)

it.each(['allocate', 'consume'])('LS mutation inside actual control RW transaction refuses %s and never publishes crypto', async phase => {
  const { a } = await prepare(); await handoff(); await cold()
  let injected = false, allocated = false
  const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get
  const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control' && value.resets?.some((r: { phase: string }) => r.phase === 'provisioning')) allocated = true
    return put.call(this, value, key)
  })
  const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    const request = get.call(this, key)
    if (!injected && this.transaction.db.name === 'arty-workspace-control' && this.transaction.mode === 'readwrite' && (phase === 'allocate' || allocated)) {
      request.addEventListener('success', () => { injected = true; localStorage.setItem(`arty-${a}-custom-instructions`, 'late A') }, { once: true })
    }
    return request
  })
  await expect(explicit(a)).rejects.toThrow()
  expect(injected).toBe(true)
  expect((await control()).resets[0].phase).toBe(phase === 'allocate' ? 'available' : 'provisioning')
  expect((await import('../../services/crypto')).isCryptoReady()).toBe(false)
  expect(localStorage.getItem(`arty-${a}-api-keys`)).toBeNull()
  getSpy.mockRestore(); putSpy.mockRestore()
}, 30_000)

it('transition API rejects reverse edges, changed identity/owner and mutable caller snapshots', async () => {
  const { a } = await prepare(); await handoff(); await cold()
  await explicit(a)
  const { advanceResetControl } = await import('../../services/workspaceWriter/resetStore'), current = await control(), original = current.resets[0]
  const put = vi.spyOn(IDBObjectStore.prototype, 'put')
  for (const value of [{ ...original, phase: 'available' }, { ...original, owner: 'b' }, { ...original, resetId: crypto.randomUUID() }]) {
    await expect(advanceResetControl(current, value, () => runtime.assertDocumentWorkspace(), () => {})).rejects.toThrow()
  }
  expect(put).not.toHaveBeenCalled(); expect(await control()).toEqual(current)
}, 30_000)

it.each(['epoch', 'document'])('transition API intrinsically rejects %s loss inside the real IDB transaction, even with a weak caller', async reason => {
  const { a, b } = await prepare(); await handoff(); await cold()
  native.reopen.mockRejectedValueOnce(new Error('leave provisioning')); await expect(explicit(a)).rejects.toThrow()
  const current = await control(), { bundle: _bundle, ...identity } = current.resets[0]
  const users = await import('../../services/userSession'), { advanceResetControl } = await import('../../services/workspaceWriter/resetStore')
  const get = IDBObjectStore.prototype.get, beforePut = vi.fn()
  let injected = false
  const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    const request = get.call(this, key)
    if (!injected && this.transaction.db.name === 'arty-workspace-control' && this.transaction.mode === 'readwrite') {
      request.addEventListener('success', () => {
        injected = true
        if (reason === 'document') runtime.documentWorkspace.retire()
        else { users.setActiveSession(account(b), { remember: false }); users.setActiveSession(account(a), { remember: false }) }
      }, { once: true })
    }
    return request
  })
  const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put')
  await expect(advanceResetControl(current, { ...identity, phase: 'consumed' }, () => {}, beforePut)).rejects.toThrow()
  expect(injected).toBe(true); expect(beforePut).not.toHaveBeenCalled(); expect(putSpy).not.toHaveBeenCalled()
  getSpy.mockRestore(); putSpy.mockRestore(); expect(await control()).toEqual(current)
}, 30_000)

it.each(['epoch', 'document'])('allocation stops when %s changes during the actual KDF', async reason => {
  const { a, b } = await prepare(); await handoff(); await cold()
  const before = await control(), entered = deferred(), release = deferred(), derive = crypto.subtle.deriveKey.bind(crypto.subtle)
  let stopped = false
  const spy = vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (...args) => {
    if (!stopped) { stopped = true; entered.resolve(); await release.promise }
    return derive(...args)
  })
  const pending = explicit(a), rejected = expect(pending).rejects.toThrow()
  await entered.promise
  if (reason === 'document') await endDocument()
  else {
    const users = await import('../../services/userSession'); users.setActiveSession(account(b), { remember: false }); users.setActiveSession(account(a), { remember: false })
  }
  release.resolve(); await rejected; spy.mockRestore()
  expect(await control()).toEqual(before)
  expect((await import('../../services/crypto')).isCryptoReady()).toBe(false)
}, 30_000)

it('failed async grant finalization keeps consumed crypto and retries login without another allocation', async () => {
  const { a, layout } = await prepare(); await handoff(); await cold()
  const users = await import('../../services/userSession'); users.clearActiveSession()
  const { useAuth } = await import('../../hooks/useAuth'), auth = renderHook(() => useAuth())
  const credentials = { identifier: 'new-key-a', anthropicKey: 'new-key-a', displayName: 'A' }
  await act(async () => {
    await expect(auth.result.current.login('apikey', credentials, async () => { throw new Error('grant cut') })).rejects.toThrow('grant cut')
  })
  const salt = localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt')), consumed = await control()
  expect(consumed.resets[0].phase).toBe('consumed'); expect(auth.result.current.currentUser).toBeNull()
  expect(localStorage.getItem(`arty-${a}-api-keys`)).toBeNull()
  await act(async () => { await auth.result.current.login('apikey', credentials) })
  expect(await control()).toEqual(consumed); expect(localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt'))).toBe(salt)
  expect(auth.result.current.currentUser?.userId).toBe(a)
}, 30_000)

it.each(['allocated', 'salt', 'check', 'version', 'native', 'consumed'])('crash at %s resumes the exact bundle and consumes once', async point => {
  const { a, layout } = await prepare(); await handoff(); await cold()
  const put = IDBObjectStore.prototype.put, set = Storage.prototype.setItem
  let allocated: unknown, crashed = false
  const putFault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control' && value.version === 7) {
      const r = value.resets.find((r: { owner: string }) => r.owner === a)
      if (r.phase === 'provisioning') allocated = structuredClone(r.bundle)
      if (!crashed && point === 'consumed' && r.phase === 'consumed') {
        crashed = true; const request = put.call(this, value, key)
        this.transaction.addEventListener('complete', () => lock.resolve(), { once: true }); return request
      }
    }
    return put.call(this, value, key)
  })
  const setFault = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (!crashed && (point === 'allocated' ? key === workspaceDataKey(layout, a, 'crypto-salt') : key === workspaceDataKey(layout, a, `crypto-${point}` as 'crypto-salt'))) {
      crashed = true
      if (point !== 'allocated') set.call(this, key, value)
      throw new Error('synthetic cut')
    }
    return set.call(this, key, value)
  })
  if (point === 'native') native.reopen.mockRejectedValueOnce(new Error('native cut'))
  await expect(explicit(a)).rejects.toThrow()
  putFault.mockRestore(); setFault.mockRestore()
  expect(allocated).toBeDefined()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  const { crypt, users } = await explicit(a)
  expect(await crypt.selfTestCrypto()).toBe(true)
  expect(localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt'))).toBe((allocated as { salt: string }).salt)
  expect((await control()).resets[0].phase).toBe('consumed')
  users.rememberSession(account(a)); await writeAndRead(`after-${point}`)
}, 30_000)

it('pending rights cannot be consumed by ordinary init; wrong key and consumed missing salt never allocate', async () => {
  const { a, layout } = await prepare(); await handoff(); await cold()
  let users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
  users.setActiveSession(account(a), { remember: false })
  await expect(crypt.initCrypto('new-key-a')).rejects.toThrow()
  native.reopen.mockRejectedValueOnce(new Error('cut')); await expect(explicit(a)).rejects.toThrow()
  const before = await control(), salt = localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt'))
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  await expect(explicit(a, 'wrong')).rejects.toThrow()
  expect(await control()).toEqual(before); expect(localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt'))).toBe(salt)
  await explicit(a)
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
  localStorage.removeItem(workspaceDataKey(layout, a, 'crypto-salt'))
  const consumed = await control(); await expect(explicit(a)).rejects.toThrow()
  expect(await control()).toEqual(consumed); expect(localStorage.getItem(workspaceDataKey(layout, a, 'crypto-salt'))).toBeNull()
  expect(crypt.isCryptoReady()).toBe(false); expect(users.getActiveUserId()).toBe(a)
}, 30_000)
