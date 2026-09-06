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
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true }))
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
async function seedLegacy(migratedA = true, realB = false) {
  expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  const users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
  const a = await users.generateUserId('apikey', 'new-key-a'), b = realB ? await users.generateUserId('apikey', 'key-b') : `${a}-b`
  users.setActiveSession(account(b)); await crypt.initCrypto('key-b'); const savedB = await writeAndRead('B')
  if (realB) localStorage.setItem(`arty-${b}-api-keys`, JSON.stringify({ anthropic: 'key-b' }))
  if (migratedA) { users.setActiveSession(account(a)); await crypt.initCrypto(realB ? 'new-key-a' : 'old-key-a'); await writeAndRead('old-A') }
  return { a, b, savedB }
}
async function prepare(migratedA = true) {
  const { a, b, savedB } = await seedLegacy(migratedA)
  await newDocument(); const layout = await (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().start()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  const users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
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

type MigrationCut = 'verified' | 'copied-complete' | 'copied-partial' | 'copied-absent' | 'no-journal' | 'reserved-no-plan' | 'reserved' | 'inventoried' | 'barrier'
async function interruptedMigration(phase: MigrationCut = 'verified', extraOwners: string[] = []) {
  const seeded = await seedLegacy(true, true)
  expect(localStorage.getItem(`arty-${seeded.a}-api-keys`)).toBeNull() // A's key unavailable BEFORE the source snapshot
  for (const owner of extraOwners) {
    (await import('../../services/userSession')).setActiveSession(account(owner))
    await (await import('../../services/crypto')).initCrypto('synthetic-control-key')
  }
  await newDocument()
  const put = IDBObjectStore.prototype.put
  const open = indexedDB.open.bind(indexedDB), opening = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
    if (phase === 'no-journal' && name.endsWith('-migration') && version === 1) throw new Error('journal creation cut')
    return open(name, version)
  })
  let copied = false
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value.version === 3 && value.phase === 'copied') {
      copied = true
      if (phase === 'copied-absent') this.transaction.addEventListener('complete', () => lock.resolve(), { once: true })
    }
    if ((phase === 'reserved-no-plan' && this.name === 'journal' && key === 'plan') ||
      (phase === 'reserved' && value.version === 3 && value.phase === 'inventoried') ||
      (phase === 'inventoried' && value.version === 3 && value.phase === 'barrier') ||
      (phase === 'barrier' && this.name === 'projects' && this.transaction.db.name.endsWith('-migration')) ||
      (phase === 'verified' && value.version === 2 && value.state === 'ready') ||
      (phase === 'copied-complete' && value.version === 3 && value.phase === 'verified') ||
      (phase === 'copied-partial' && copied && this.name === 'projects' && this.transaction.db.name.startsWith('arty-workspace-'))) throw new Error('migration cut')
    return put.call(this, value, key)
  })
  const oldActor = (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration()
  await expect(oldActor.start()).rejects.toThrow()
  fault.mockRestore(); opening.mockRestore()
  const header = await control()
  const expected = phase === 'verified' ? 'verified' : phase.startsWith('copied') ? 'copied' : ['no-journal', 'reserved-no-plan', 'reserved'].includes(phase) ? 'reserved' : phase
  expect(header).toMatchObject({ version: 3, phase: expected })
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  return { ...seeded, header, oldActor }
}
async function rawCopies() {
  const databases = await indexedDB.databases(), copies: unknown[] = []
  for (const info of databases.sort((a, b) => a.name!.localeCompare(b.name!))) {
    if (info.name === 'arty-workspace-control') continue
    const db = await openDB(info.name!)
    try {
      const stores = []
      for (const name of db.objectStoreNames) stores.push([name, await db.getAllKeys(name), await db.getAll(name)])
      copies.push([info.name, db.version, stores])
    } finally { db.close() }
  }
  return { local: Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]), copies }
}

it.each(['first', 'last'] as const)('real cancellation UI keeps %s-target quota active; keyless A preserved, B decrypts/writes/reloads', async position => {
  const { a, b, savedB, header } = await interruptedMigration('reserved')
  const { localTargets } = await import('../../services/workspaceWriter/migrationInventory')
  const db = await openDB(`arty-workspace-${header.generation}-migration`), plan = await db.get('journal', 'plan'); db.close()
  const targets = localTargets(plan, header.generation)
  // Set a fixed byte budget too small for first/last duplicate. Keep that SAME
  // origin quota throughout cancellation, subsequent real writes and reload.
  for (const [key] of targets) localStorage.removeItem(key)
  const original = Storage.prototype.setItem
  const bytes = () => Object.keys(localStorage).reduce((sum, key) => sum + 2 * (key.length + localStorage.getItem(key)!.length), 0)
  const duplicateBytes = targets.map(([key, value]) => 2 * (key.length + value.length))
  const capacity = bytes() + (position === 'first' ? duplicateBytes[0] : duplicateBytes.reduce((sum, n) => sum + n, 0)) - 1
  const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    const old = this.getItem(key), next = bytes() - (old === null ? 0 : 2 * (key.length + old.length)) + 2 * (key.length + String(value).length)
    if (this === localStorage && next > capacity) throw new DOMException('persistent synthetic origin quota', 'QuotaExceededError')
    return original.call(this, key, value)
  })
  await expect((await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().resume()).rejects.toThrow()
  expect((await control()).phase).toBe('reserved')
  expect(targets.filter(([key]) => localStorage.getItem(key) !== null)).toHaveLength(position === 'first' ? 0 : targets.length - 1)
  const before = await rawCopies()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  const derive = vi.spyOn(crypto.subtle, 'deriveKey'), decrypt = vi.spyOn(crypto.subtle, 'decrypt')
  const nativeModule = await import('../../services/native/coldMailErasure'), nativeCheck = vi.spyOn(nativeModule, 'assertNativeErasureOwner')
  const { DocumentWorkspaceGate } = await import('../../components/workspace/DocumentWorkspaceGate'), privateImport = vi.fn(() => createElement('div', {}, 'private'))
  window.history.replaceState({}, '', '/auth/callback?code=synthetic&state=keep#fragment'); sessionStorage.setItem('synthetic-verifier', 'keep')
  render(createElement(DocumentWorkspaceGate, { controller: runtime.documentWorkspace, admission: runtime.workspaceAdmission, Content: privateImport }))
  fireEvent.click(await screen.findByText('workspaceAdmission.migrationCancellation.inspect'))
  const confirm = await screen.findByText('workspaceAdmission.migrationCancellation.confirmCta')
  expect(screen.queryByRole('radio')).toBeNull(); expect(await rawCopies()).toEqual(before)
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm) })
  await screen.findByText('workspaceAdmission.migrationCancellation.done')
  expect(await control()).toMatchObject({ version: 1, layout: 'legacy-v1', state: 'ready', revision: header.revision + 1 })
  expect(privateImport).not.toHaveBeenCalled(); expect(derive).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled(); expect(nativeCheck).not.toHaveBeenCalled()
  expect(native.reopen).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  expect(window.location.href).toContain('/auth/callback?code=synthetic&state=keep#fragment'); expect(sessionStorage.getItem('synthetic-verifier')).toBe('keep')
  expect(() => runtime.workspaceAdmission.assertReady()).toThrow()
  const after = await rawCopies()
  expect(after.local).toEqual(before.local.filter(([key]) => !key!.startsWith('arty-workspace:')))
  expect(after.copies.filter(copy => ['arty-files', 'arty-projects'].includes((copy as string[])[0]))).toEqual(before.copies.filter(copy => ['arty-files', 'arty-projects'].includes((copy as string[])[0])))
  expect(localStorage.getItem(`arty-${a}-api-keys`)).toBeNull()
  expect(() => localStorage.setItem('synthetic-over-quota', 'x'.repeat(capacity))).toThrow('persistent synthetic origin quota')
  derive.mockRestore(); decrypt.mockRestore()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  let users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
  users.setActiveSession(account(b)); await crypt.initCrypto('key-b'); await readAndUpdate(savedB)
  const history = await import('../../services/storage'), old = history.getConversation('B')!
  history.saveConversation({ ...old, title: 'B edit' })
  await vi.waitFor(() => expect(localStorage.getItem(`arty-${b}-conversations`)).toBeNull())
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  users = await import('../../services/userSession'); crypt = await import('../../services/crypto'); users.setActiveSession(account(b)); await crypt.initCrypto('key-b')
  const reloaded = await import('../../services/storage'); await reloaded.bootstrapConversationStorage()
  expect(reloaded.getConversation('B')?.title).toBe('B edit')
  expect((await (await import('../../services/secureFileStorage')).getFile('B'))?.data).toBe('QQ==')
  const projects = await import('../../services/projects/store')
  expect(await projects.getProject(await projects.beginProjectOperation(), savedB.id)).toMatchObject({ status: 'ready', project: { name: 'B updated' } })
  expect(() => localStorage.setItem('synthetic-over-quota', 'x'.repeat(capacity))).toThrow('persistent synthetic origin quota')
  expect(quota).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
}, 30_000)

it('cancellation UI after partial cleanup requires reload, never retries or automatically resumes a planless migration', async () => {
  const { header } = await interruptedMigration('reserved'), service = await import('../../services/workspaceWriter/migration')
  const factory = service.createColdMigrationCancellation, confirms = vi.fn()
  vi.spyOn(service, 'createColdMigrationCancellation').mockImplementation(() => {
    const actor = factory(); return { ...actor, confirm: async () => { confirms(); await actor.confirm() } }
  })
  const put = IDBObjectStore.prototype.put, fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control' && value.version === 1) throw new Error('before final cas')
    return put.call(this, value, key)
  })
  const { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery')
  render(createElement(Recovery)); fireEvent.click(screen.getByText('workspaceAdmission.migrationCancellation.inspect'))
  const confirm = await screen.findByText('workspaceAdmission.migrationCancellation.confirmCta')
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm) })
  await screen.findByText('workspaceAdmission.migrationCancellation.failed'); fault.mockRestore()
  expect(confirms).toHaveBeenCalledOnce(); expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.getByText('workspaceWindow.reload')).toBeVisible()
  expect(screen.queryByText('workspaceAdmission.recovery.failed')).toBeNull()
  const db = await openDB(`arty-workspace-${header.generation}-migration`); expect(await db.getAllKeys('journal')).toEqual(['identity']); db.close()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  const resumed = vi.spyOn(await import('../../services/workspaceWriter/migration'), 'createColdWorkspaceMigration')
  const Fresh = (await import('../../components/workspace/ColdMigrationRecovery')).default
  render(createElement(Fresh)); expect(resumed).not.toHaveBeenCalled(); expect(await control()).toEqual(header)
  fireEvent.click(screen.getByText('workspaceAdmission.migrationCancellation.inspect'))
  await screen.findByText('workspaceAdmission.migrationCancellation.initialInventory')
  expect(await control()).toEqual(header)
  fireEvent.click(screen.getByText('workspaceAdmission.migrationCancellation.confirmCta'))
  await screen.findByText('workspaceAdmission.migrationCancellation.done'); expect((await control()).version).toBe(1)
}, 30_000)

it.each(['import', 'inspection'] as const)('cancellation UI unmount during %s never confirms or warms the app', async phase => {
  await interruptedMigration('reserved')
  const service = await import('../../services/workspaceWriter/migration'), original = service.createColdMigrationCancellation
  const pending = deferred(), confirm = vi.fn()
  const factory = vi.spyOn(service, 'createColdMigrationCancellation').mockImplementation(() => {
    const actor = original()
    return { ...actor, inspect: async () => { const snapshot = await actor.inspect(); await pending.promise; return snapshot }, confirm }
  })
  const { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery'), before = await rawCopies()
  const view = render(createElement(Recovery))
  act(() => { fireEvent.click(screen.getByText('workspaceAdmission.migrationCancellation.inspect')); if (phase === 'import') view.unmount() })
  if (phase === 'inspection') { await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce()); view.unmount() }
  await act(async () => { pending.resolve(); await Promise.resolve() })
  expect(factory).toHaveBeenCalledTimes(phase === 'import' ? 0 : 1); expect(confirm).not.toHaveBeenCalled()
  expect(screen.queryByText('workspaceAdmission.migrationCancellation.confirmCta')).toBeNull(); expect(await rawCopies()).toEqual(before)
}, 30_000)

it.each(['no-journal', 'reserved-no-plan', 'reserved', 'inventoried', 'barrier', 'copied-partial'] as const)('real UI prepares %s without A key or private activation, then cold erases A and B logs in/writes/reloads', async phase => {
  const { a, b, savedB, oldActor } = await interruptedMigration(phase), before = await rawCopies()
  const derive = vi.spyOn(crypto.subtle, 'deriveKey'), decrypt = vi.spyOn(crypto.subtle, 'decrypt')
  const { DocumentWorkspaceGate } = await import('../../components/workspace/DocumentWorkspaceGate'), privateImport = vi.fn(() => createElement('div', {}, 'private'))
  window.history.replaceState({}, '', '/auth/callback?code=synthetic&state=keep#fragment'); sessionStorage.setItem('synthetic-verifier', 'keep')
  render(createElement(DocumentWorkspaceGate, { controller: runtime.documentWorkspace, admission: runtime.workspaceAdmission, Content: privateImport }))
  fireEvent.click(await screen.findByText('workspaceAdmission.erasurePreparation.inspect'))
  await screen.findByText('workspaceAdmission.erasurePreparation.confirmCta')
  expect(!!screen.queryByText('workspaceAdmission.erasurePreparation.initialInventory')).toBe(phase === 'no-journal' || phase === 'reserved-no-plan')
  expect(await rawCopies()).toEqual(before)
  fireEvent.click(screen.getByText('workspaceAdmission.erasurePreparation.confirmCta'))
  await screen.findByText('workspaceAdmission.erasurePreparation.done')
  expect(await control()).toMatchObject({ version: 3, phase: 'verified' })
  expect(privateImport).not.toHaveBeenCalled(); expect(derive).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled()
  expect(() => runtime.workspaceAdmission.assertReady()).toThrow()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  const { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery')
  render(createElement(Recovery))
  fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.inspect'))
  fireEvent.click(await screen.findByRole('radio', { name: new RegExp(`"${a}"`) }))
  fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.review'))
  fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.confirmCta'))
  await screen.findByText('workspaceAdmission.migrationErasure.recorded')
  expect((await control()).erasure.owner).toBe(a)
  expect(location.search + location.hash).toBe('?code=synthetic&state=keep#fragment'); expect(sessionStorage.getItem('synthetic-verifier')).toBe('keep')
  await cold()
  expect(derive).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled(); derive.mockRestore(); decrypt.mockRestore()
  const { useAuth } = await import('../../hooks/useAuth'), auth = renderHook(() => useAuth())
  await act(async () => { await auth.result.current.login('apikey', { identifier: 'key-b', anthropicKey: 'key-b', displayName: 'B' }) })
  expect(auth.result.current.currentUser?.userId).toBe(b)
  await readAndUpdate(savedB); const added = await writeAndRead(`B-after-preparation-${phase}`)
  auth.unmount(); await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  const users = await import('../../services/userSession'); users.setActiveSession(account(b)); await (await import('../../services/crypto')).initCrypto('key-b')
  await readAndUpdate(savedB); await readAndUpdate(added)
  await expect(oldActor.resume()).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled()
  window.history.replaceState({}, '', '/')
}, 30_000)

it.each(['plan', 'inventoried', 'barrier', 'copied', 'verified', 'verified-changed'])('preparation resumes an exact lost acknowledgement at %s without becoming ready', async point => {
  const { header } = await interruptedMigration('no-journal'), actor = (await import('../../services/workspaceWriter/migration')).createColdErasurePreparation()
  expect(await actor.inspect()).toEqual({ initialInventory: true })
  const originalTimeout = setTimeout, put = IDBObjectStore.prototype.put
  let expire!: () => void, cut = false
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    if (ms === 120_000) expire = fn
    return originalTimeout(fn, ms)
  }) as typeof setTimeout)
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (!cut && (point === 'plan' ? this.name === 'journal' && key === 'plan' : value.version === 3 && value.phase === (point === 'verified-changed' ? 'verified' : point))) {
      cut = true; this.transaction.addEventListener('complete', () => expire(), { once: true })
    }
    return put.call(this, value, key)
  })
  await expect(actor.prepare()).rejects.toMatchObject({ code: 'cancelled' }); fault.mockRestore(); timer.mockRestore(); expect(cut).toBe(true)
  expect((await control()).generation).toBe(header.generation)
  if (point === 'verified-changed') localStorage.setItem('synthetic-source-change', 'keep')
  const writes = vi.spyOn(IDBObjectStore.prototype, 'put'), localWrites = vi.spyOn(Storage.prototype, 'setItem')
  if (point === 'verified-changed') await expect(actor.prepare()).rejects.toThrow()
  else await actor.prepare()
  expect(await control()).toMatchObject({ version: 3, phase: 'verified', generation: header.generation })
  if (point.startsWith('verified')) { expect(writes).not.toHaveBeenCalled(); expect(localWrites).not.toHaveBeenCalled() }
}, 30_000)

it('preparation retry after partial target quota retains the first plan and refuses any new source baseline', async () => {
  await interruptedMigration('reserved-no-plan')
  const actor = (await import('../../services/workspaceWriter/migration')).createColdErasurePreparation(); await actor.inspect()
  const set = Storage.prototype.setItem; let targets = 0
  const fault = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith('arty-workspace:') && ++targets === 2) throw new DOMException('synthetic quota', 'QuotaExceededError')
    return set.call(this, key, value)
  })
  await expect(actor.prepare()).rejects.toThrow(); fault.mockRestore(); expect(targets).toBe(2)
  const header = await control(), db = await openDB(`arty-workspace-${header.generation}-migration`), plan = await db.get('journal', 'plan'); db.close()
  localStorage.setItem('synthetic-source-change', 'keep')
  const writes = vi.spyOn(IDBObjectStore.prototype, 'put'), before = await rawCopies()
  await expect(actor.prepare()).rejects.toThrow(); expect(writes).not.toHaveBeenCalled(); expect(await rawCopies()).toEqual(before)
  localStorage.removeItem('synthetic-source-change'); await actor.prepare()
  const job = await openDB(`arty-workspace-${header.generation}-migration`); expect(await job.get('journal', 'plan')).toEqual(plan); job.close()
  expect(await control()).toMatchObject({ version: 3, phase: 'verified' })
}, 30_000)

it.each(['rollback', 'future', 'v2'])('a %s header cannot replace the exact preparation progression after lost copied acknowledgement', async replacement => {
  const { header } = await interruptedMigration('no-journal'), actor = (await import('../../services/workspaceWriter/migration')).createColdErasurePreparation(); await actor.inspect()
  const timeout = setTimeout, put = IDBObjectStore.prototype.put; let expire!: () => void
  const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => { if (ms === 120_000) expire = fn; return timeout(fn, ms) }) as typeof setTimeout)
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value.version === 3 && value.phase === 'copied') this.transaction.addEventListener('complete', () => expire(), { once: true })
    return put.call(this, value, key)
  })
  await expect(actor.prepare()).rejects.toMatchObject({ code: 'cancelled' }); fault.mockRestore(); timer.mockRestore()
  const committed = await control(), job = await openDB(`arty-workspace-${header.generation}-migration`), plan = await job.get('journal', 'plan'); job.close()
  expect(committed.phase).toBe('copied')
  const foreign = replacement === 'rollback' ? header : replacement === 'future' ? { ...committed, revision: committed.revision + 1 } :
    { format: header.format, version: 2, layout: 'isolated-v1', state: 'ready', revision: committed.revision + 1, generation: header.generation, requiredOwners: plan.owners }
  const db = await openDB('arty-workspace-control'); await db.put('meta', foreign, 'workspace'); db.close()
  const before = await rawCopies(), writes = vi.spyOn(IDBObjectStore.prototype, 'put'), localWrites = vi.spyOn(Storage.prototype, 'setItem')
  await expect(actor.prepare()).rejects.toMatchObject({ code: 'changed' })
  expect(writes).not.toHaveBeenCalled(); expect(localWrites).not.toHaveBeenCalled(); expect(await rawCopies()).toEqual(before); expect(await control()).toEqual(foreign)
}, 30_000)

it.each(['source', 'revision', 'v2', 'copy'])('preparation refuses changed %s after inspection without new writes', async change => {
  const { header } = await interruptedMigration(change === 'copy' || change === 'v2' ? 'copied-partial' : 'no-journal')
  const actor = (await import('../../services/workspaceWriter/migration')).createColdErasurePreparation(); await actor.inspect()
  if (change === 'source') localStorage.setItem('synthetic-source-change', 'keep')
  if (change === 'revision' || change === 'v2') {
    let next = { ...header, revision: header.revision + 1 }
    if (change === 'v2') {
      const job = await openDB(`arty-workspace-${header.generation}-migration`), plan = await job.get('journal', 'plan'); job.close()
      next = { format: header.format, version: 2, layout: 'isolated-v1', state: 'ready', revision: header.revision + 1, generation: header.generation, requiredOwners: plan.owners }
    }
    const db = await openDB('arty-workspace-control'); await db.put('meta', next, 'workspace'); db.close()
  }
  if (change === 'copy') {
    const db = await openDB(`arty-workspace-${header.generation}-files`), keys = await db.getAllKeys('files'), row = await db.get('files', keys[0]!)
    await db.put('files', { ...row, foreign: true }); db.close()
  }
  const before = await rawCopies(), expected = await control(), put = vi.spyOn(IDBObjectStore.prototype, 'put'), set = vi.spyOn(Storage.prototype, 'setItem')
  await expect(actor.prepare()).rejects.toThrow()
  expect(put).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(await rawCopies()).toEqual(before); expect(await control()).toEqual(expected)
}, 30_000)

it.each(['journal-row', 'destination', 'target', 'source-v2'])('initial inventory refuses preexisting %s without a plan and without writes', async fragment => {
  const { a, header } = await interruptedMigration('reserved-no-plan')
  if (fragment === 'journal-row') {
    const source = await openDB('arty-files'), keys = await source.getAllKeys('files'), row = await source.get('files', keys[0]!); source.close()
    const job = await openDB(`arty-workspace-${header.generation}-migration`); await job.put('files', row, keys[0]!); job.close()
  }
  if (fragment === 'destination') {
    const { FILE_SHAPE, createDatabaseShape } = await import('../../services/workspaceWriter/schema')
    const db = await openDB(`arty-workspace-${header.generation}-files`, 1, { upgrade(db) { createDatabaseShape(db, FILE_SHAPE) } }); db.close()
  }
  if (fragment === 'target') localStorage.setItem(workspaceDataKey((await import('../../services/workspaceWriter/layout')).isolatedWorkspaceLayout(header.generation, [a]), a, 'crypto-salt'), 'fragment')
  if (fragment === 'source-v2') { const db = await openDB('arty-files', 2); db.close() }
  const before = await rawCopies(), put = vi.spyOn(IDBObjectStore.prototype, 'put'), set = vi.spyOn(Storage.prototype, 'setItem')
  await expect((await import('../../services/workspaceWriter/migration')).createColdErasurePreparation().inspect()).rejects.toThrow()
  expect(put).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(await rawCopies()).toEqual(before); expect(await control()).toEqual(header)
}, 30_000)

it.each(['local', 'document'])('verified-only never publishes its last checkpoint after %s loss inside the actual CAS', async reason => {
  const { header } = await interruptedMigration('copied-partial'), actor = (await import('../../services/workspaceWriter/migration')).createColdErasurePreparation(); await actor.inspect()
  const get = IDBObjectStore.prototype.get; let injected = false
  const put = vi.spyOn(IDBObjectStore.prototype, 'put')
  const fault = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    const request = get.call(this, key)
    if (!injected && this.transaction.db.name === 'arty-workspace-control' && this.transaction.mode === 'readwrite') request.addEventListener('success', () => {
      injected = true
      if (reason === 'local') localStorage.setItem('synthetic-late-source', 'keep')
      else runtime.documentWorkspace.retire()
    }, { once: true })
    return request
  })
  await expect(actor.prepare()).rejects.toThrow(); expect(injected).toBe(true)
  expect(put.mock.calls.some(([value]) => value.version === 3 && value.phase === 'verified')).toBe(false)
  expect(await control()).toEqual(header); fault.mockRestore()
}, 30_000)

it('first plan installation refuses a late LS change in its own journal transaction', async () => {
  const { header } = await interruptedMigration('no-journal'), actor = (await import('../../services/workspaceWriter/migration')).createColdErasurePreparation(); await actor.inspect()
  const count = IDBObjectStore.prototype.count; let injected = false
  const fault = vi.spyOn(IDBObjectStore.prototype, 'count').mockImplementation(function (this: IDBObjectStore, key) {
    const request = count.call(this, key)
    if (!injected && this.name === 'journal' && this.transaction.mode === 'readwrite' && key === 'plan') request.addEventListener('success', () => {
      injected = true; localStorage.setItem('synthetic-late-source', 'keep')
    }, { once: true })
    return request
  })
  await expect(actor.prepare()).rejects.toThrow(); fault.mockRestore(); expect(injected).toBe(true)
  const job = await openDB(`arty-workspace-${header.generation}-migration`); expect(await job.get('journal', 'plan')).toBeUndefined(); job.close()
  expect(await control()).toEqual(header)
}, 30_000)

it('a divergent partial fragment is never overwritten or promoted to verified', async () => {
  const { header } = await interruptedMigration('copied-partial'), db = await openDB(`arty-workspace-${header.generation}-files`)
  const keys = await db.getAllKeys('files'), row = { ...await db.get('files', keys[0]!), foreign: true }; await db.put('files', row); db.close()
  const actor = (await import('../../services/workspaceWriter/migration')).createColdErasurePreparation(); await actor.inspect()
  await expect(actor.prepare()).rejects.toThrow()
  const checked = await openDB(`arty-workspace-${header.generation}-files`); expect(await checked.get('files', keys[0]!)).toEqual(row); checked.close()
  expect(await control()).toEqual(header)
}, 30_000)

it('anonymous-only UI refuses erasure preparation without writes and still permits normal recovery after reload', async () => {
  localStorage.setItem('arty-crypto-salt', JSON.stringify(Array(16).fill(7))); localStorage.setItem('arty-conversations', 'anonymous history')
  const put = IDBObjectStore.prototype.put, fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value.version === 3 && value.phase === 'inventoried') throw new Error('cut')
    return put.call(this, value, key)
  })
  await expect((await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().start()).rejects.toThrow(); fault.mockRestore()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  const before = await rawCopies(), { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery')
  render(createElement(Recovery)); fireEvent.click(screen.getByText('workspaceAdmission.erasurePreparation.inspect'))
  await screen.findByText('workspaceAdmission.erasurePreparation.noAccount')
  expect(screen.queryByText('workspaceAdmission.erasurePreparation.confirmCta')).toBeNull(); expect(await rawCopies()).toEqual(before)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  await (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().resume()
  expect((await control()).version).toBe(2); expect(localStorage.getItem('arty-conversations')).toBe('anonymous history')
}, 30_000)

it('real preparation UI retries a transient target quota without changing action or opening private storage', async () => {
  await interruptedMigration('reserved-no-plan')
  const { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery'), set = Storage.prototype.setItem
  render(createElement(Recovery)); fireEvent.click(screen.getByText('workspaceAdmission.erasurePreparation.inspect'))
  await screen.findByText('workspaceAdmission.erasurePreparation.confirmCta')
  let targets = 0
  const fault = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith('arty-workspace:') && ++targets === 2) throw new DOMException('quota', 'QuotaExceededError')
    return set.call(this, key, value)
  })
  fireEvent.click(screen.getByText('workspaceAdmission.erasurePreparation.confirmCta')); await screen.findByText('workspaceAdmission.erasurePreparation.retryCta')
  fault.mockRestore(); expect((await control()).phase).toBe('reserved')
  expect(screen.queryByText('workspaceAdmission.recovery.resume')).toBeNull(); expect(screen.queryByText('workspaceAdmission.migrationErasure.inspect')).toBeNull()
  fireEvent.click(screen.getByText('workspaceAdmission.erasurePreparation.retryCta')); await screen.findByText('workspaceAdmission.erasurePreparation.done')
  expect(await control()).toMatchObject({ version: 3, phase: 'verified' }); expect(() => runtime.workspaceAdmission.assertReady()).toThrow()
}, 30_000)

it.each(['import', 'inspection'] as const)('preparation unmount during %s cannot write or create a late actor', async phase => {
  await interruptedMigration('no-journal')
  const service = await import('../../services/workspaceWriter/migration'), original = service.createColdErasurePreparation
  let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve })
  const factory = vi.spyOn(service, 'createColdErasurePreparation').mockImplementation(() => {
    const actor = original(); return { ...actor, inspect: async () => { const result = await actor.inspect(); await pending; return result } }
  })
  const { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery'), before = await rawCopies(), view = render(createElement(Recovery))
  act(() => { fireEvent.click(screen.getByText('workspaceAdmission.erasurePreparation.inspect')); if (phase === 'import') view.unmount() })
  if (phase === 'inspection') { await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce()); view.unmount() }
  await act(async () => { finish(); await Promise.resolve() })
  expect(factory).toHaveBeenCalledTimes(phase === 'import' ? 0 : 1); expect(screen.queryByText('workspaceAdmission.erasurePreparation.confirmCta')).toBeNull()
  expect(await rawCopies()).toEqual(before)
}, 30_000)

it.each(['verified', 'copied-complete'] as const)('real cold UI supersedes %s before purge, B logs in/reads/writes, A recreates and erases again', async phase => {
  const { a, b, savedB } = await interruptedMigration(phase), before = await rawCopies()
  const { DocumentWorkspaceGate } = await import('../../components/workspace/DocumentWorkspaceGate'), privateImport = vi.fn(() => createElement('div', {}, 'private'))
  window.history.replaceState({}, '', '/auth/callback?code=synthetic&state=keep#fragment'); sessionStorage.setItem('synthetic-verifier', 'keep')
  render(createElement(DocumentWorkspaceGate, { controller: runtime.documentWorkspace, admission: runtime.workspaceAdmission, Content: privateImport }))
  fireEvent.click(await screen.findByText('workspaceAdmission.migrationErasure.inspect'))
  fireEvent.click(await screen.findByRole('radio', { name: new RegExp(`"${a}"`) }))
  fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.review'))
  expect(await rawCopies()).toEqual(before)
  fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.confirmCta'))
  await screen.findByText('workspaceAdmission.migrationErasure.recorded')
  expect((await control()).erasure.authority).toMatchObject({ owner: a, localOnly: true, serverConfirmed: false })
  expect(await rawCopies()).toEqual(before) // CAS only; no raw-copy/credential/draft purge yet
  expect(privateImport).not.toHaveBeenCalled(); expect(() => runtime.workspaceAdmission.assertReady()).toThrow()
  expect(location.search + location.hash).toBe('?code=synthetic&state=keep#fragment'); expect(sessionStorage.getItem('synthetic-verifier')).toBe('keep')
  await cold()
  let users = await import('../../services/userSession')
  expect(users.getActiveSession()).toBeNull()
  const { useAuth } = await import('../../hooks/useAuth'), auth = renderHook(() => useAuth())
  await act(async () => { await auth.result.current.login('apikey', { identifier: 'key-b', anthropicKey: 'key-b', displayName: 'B' }) })
  expect(auth.result.current.currentUser?.userId).toBe(b); await readAndUpdate(savedB); const addedB = await writeAndRead('B-after-supersession')
  act(() => auth.result.current.logout())
  await act(async () => { await auth.result.current.login('apikey', { identifier: 'new-key-a', anthropicKey: 'new-key-a', displayName: 'Fresh A' }) })
  expect(auth.result.current.currentUser?.userId).toBe(a); await writeAndRead('A-after-supersession')
  const firstReset = (await control()).resets[0].resetId
  await handoff(); await cold(); await explicit(a)
  expect((await control()).resets[0].resetId).not.toBe(firstReset)
  users = await import('../../services/userSession'); users.setActiveSession(account(b)); await (await import('../../services/crypto')).initCrypto('key-b')
  await readAndUpdate(addedB); await readAndUpdate(savedB)
  expect(fetch).not.toHaveBeenCalled()
  window.history.replaceState({}, '', '/')
}, 30_000)

it.each(['copied-partial', 'copied-absent'] as const)('cold UI refuses %s explicitly without creating or modifying storage', async phase => {
  const { header } = await interruptedMigration(phase), before = await rawCopies()
  const { DocumentWorkspaceGate } = await import('../../components/workspace/DocumentWorkspaceGate')
  render(createElement(DocumentWorkspaceGate, { controller: runtime.documentWorkspace, admission: runtime.workspaceAdmission, Content: () => createElement('div', {}, 'private') }))
  fireEvent.click(await screen.findByText('workspaceAdmission.migrationErasure.inspect'))
  await screen.findByText('workspaceAdmission.migrationErasure.incomplete')
  expect(screen.queryByText('workspaceAdmission.recovery.resume')).toBeNull()
  expect(screen.getByText('workspaceAdmission.migrationErasure.reloadChoice')).toBeVisible()
  expect(await rawCopies()).toEqual(before); expect(await control()).toEqual(header)
  expect(fetch).not.toHaveBeenCalled()
}, 30_000)

it('homonymous catalog escapes opaque control IDs but confirms their exact original bytes', async () => {
  const owner = 'a\u0085b', invisible = 'a\u200bb'
  await interruptedMigration('verified', [owner, invisible, 'ab'])
  const { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery')
  render(createElement(Recovery))
  fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.inspect'))
  fireEvent.click(await screen.findByRole('radio', { name: 'Synthetic "a\\u0085b"' }))
  expect(screen.getByRole('radio', { name: 'Synthetic "a\\u200bb"' })).not.toBeChecked()
  expect(screen.getByRole('radio', { name: 'Synthetic "ab"' })).not.toBeChecked()
  fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.review'))
  expect(screen.getByText('"a\\u0085b"')).toBeVisible()
  fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.confirmCta'))
  await screen.findByText('workspaceAdmission.migrationErasure.recorded')
  expect((await control()).erasure.owner).toBe(owner)
}, 30_000)

it.each([['resume', 'erase'], ['resume', 'prepare'], ['erase', 'resume'], ['erase', 'prepare'], ['prepare', 'resume'], ['prepare', 'erase'],
  ['cancel', 'resume'], ['cancel', 'erase'], ['cancel', 'prepare'], ['resume', 'cancel'], ['erase', 'cancel'], ['prepare', 'cancel']] as const)('UI binds first %s before lazy import and ignores %s until reload', async (first, second) => {
  await interruptedMigration()
  const service = await import('../../services/workspaceWriter/migration'), resumeFactory = service.createColdWorkspaceMigration
  const resumed = vi.spyOn(service, 'createColdWorkspaceMigration').mockImplementation(() => {
    const actor = resumeFactory()
    return { ...actor, resume: async () => { throw new Error('synthetic resume refusal') } }
  })
  const inspected = vi.spyOn(service, 'createColdMigrationErasure')
  const prepared = vi.spyOn(service, 'createColdErasurePreparation')
  const cancelled = vi.spyOn(service, 'createColdMigrationCancellation')
  const { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery')
  render(createElement(Recovery))
  const buttons = { resume: screen.getByText('workspaceAdmission.recovery.resume'), erase: screen.getByText('workspaceAdmission.migrationErasure.inspect'), prepare: screen.getByText('workspaceAdmission.erasurePreparation.inspect'), cancel: screen.getByText('workspaceAdmission.migrationCancellation.inspect') }
  act(() => {
    fireEvent.click(buttons[first]); fireEvent.click(buttons[second]); fireEvent.click(buttons[first])
  })
  await screen.findByText(first === 'cancel' ? 'workspaceWindow.reload' : 'workspaceAdmission.migrationErasure.reloadChoice')
  expect(resumed).toHaveBeenCalledTimes(first === 'resume' ? 1 : 0)
  expect(inspected).toHaveBeenCalledTimes(first === 'erase' ? 1 : 0)
  expect(prepared).toHaveBeenCalledTimes(first === 'prepare' ? 1 : 0)
  expect(cancelled).toHaveBeenCalledTimes(first === 'cancel' ? 1 : 0)
  expect(screen.queryByText('workspaceAdmission.migrationCancellation.inspect')).toBeNull()
  expect(screen.queryByText('workspaceAdmission.migrationErasure.inspect')).toBeNull()
  expect(screen.queryByText('workspaceAdmission.erasurePreparation.inspect')).toBeNull()
  if (first !== 'resume') expect(screen.queryByText('workspaceAdmission.recovery.resume')).toBeNull()
}, 30_000)

it.each(['import', 'inspection'] as const)('UI unmount during %s cannot create a late actor or reintroduce the chooser', async phase => {
  await interruptedMigration()
  const service = await import('../../services/workspaceWriter/migration'), original = service.createColdMigrationErasure
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const factory = vi.spyOn(service, 'createColdMigrationErasure').mockImplementation(() => {
    const actor = original()
    return { ...actor, inspect: async () => { const list = await actor.inspect(); await pending; return list } }
  })
  const { default: Recovery } = await import('../../components/workspace/ColdMigrationRecovery'), before = await rawCopies()
  const view = render(createElement(Recovery))
  act(() => { fireEvent.click(screen.getByText('workspaceAdmission.migrationErasure.inspect')); if (phase === 'import') view.unmount() })
  if (phase === 'inspection') { await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce()); view.unmount() }
  await act(async () => { finish(); await Promise.resolve() })
  expect(factory).toHaveBeenCalledTimes(phase === 'import' ? 0 : 1)
  expect(screen.queryByRole('radio')).toBeNull(); expect(await rawCopies()).toEqual(before)
}, 30_000)

it.each(['header', 'label', 'target', 'source', 'journal', 'destination'])('snapshot confirmation rejects changed %s without any write', async change => {
  const { a, b, header } = await interruptedMigration(), { createColdMigrationErasure } = await import('../../services/workspaceWriter/migration')
  const actor = createColdMigrationErasure(); await actor.inspect()
  if (change === 'header') { const db = await openDB('arty-workspace-control'); await db.put('meta', { ...header, revision: header.revision + 1 }, 'workspace'); db.close() }
  if (change === 'label') localStorage.setItem('arty-known-sessions', JSON.stringify([{ ...account(b), displayName: 'Changed' }, account(a)]))
  if (change === 'target') localStorage.removeItem(Object.keys(localStorage).find(k => k.startsWith('arty-workspace:'))!)
  if (change === 'source') localStorage.setItem(`arty-${b}-api-keys`, 'changed')
  if (change === 'journal' || change === 'destination') {
    const name = `arty-workspace-${header.generation}-${change === 'journal' ? 'migration' : 'projects'}`
    const db = await openDB(name), keys = await db.getAllKeys('projects')
    const row = await db.get('projects', keys[0]!)
    if (change === 'journal') await db.put('projects', { ...row, changed: true }, keys[0]!)
    else await db.put('projects', { ...row, changed: true })
    db.close()
  }
  const before = await rawCopies(), controlBefore = await control(), put = vi.spyOn(IDBObjectStore.prototype, 'put'), set = vi.spyOn(Storage.prototype, 'setItem')
  await expect(actor.confirm(a)).rejects.toThrow()
  expect(put).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled()
  expect(await rawCopies()).toEqual(before); expect(await control()).toEqual(controlBefore)
}, 30_000)

it.each(['local', 'document'])('supersession refuses %s loss inside the actual control CAS transaction', async reason => {
  const { a, header } = await interruptedMigration(), actor = (await import('../../services/workspaceWriter/migration')).createColdMigrationErasure()
  await actor.inspect()
  const get = IDBObjectStore.prototype.get, put = vi.spyOn(IDBObjectStore.prototype, 'put')
  let injected = false
  const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    const request = get.call(this, key)
    if (!injected && this.transaction.db.name === 'arty-workspace-control' && this.transaction.mode === 'readwrite') {
      request.addEventListener('success', () => {
        injected = true
        if (reason === 'local') localStorage.setItem('synthetic-late-change', 'keep')
        else runtime.documentWorkspace.retire()
      }, { once: true })
    }
    return request
  })
  await expect(actor.confirm(a)).rejects.toThrow()
  expect(injected).toBe(true); expect(put).not.toHaveBeenCalled(); expect(await control()).toEqual(header)
  if (reason === 'local') expect(localStorage.getItem('synthetic-late-change')).toBe('keep')
  getSpy.mockRestore()
}, 30_000)

it('caller catalog changes and concurrent A/B confirmations cannot change the selected authority or nonce on retry', async () => {
  const { a, b, header, oldActor } = await interruptedMigration(), service = await import('../../services/workspaceWriter/migration'), actor = service.createColdMigrationErasure()
  const list = await actor.inspect(); list.push({ owner: 'not-attested', label: 'A' }); list[0]!.owner = 'forged'
  await expect(actor.confirm('not-attested')).rejects.toThrow()
  expect(() => service.createColdWorkspaceMigration()).toThrow() // one cold actor, not a UI-only fence
  let attempted: unknown
  const put = IDBObjectStore.prototype.put, fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value.version === 6) { attempted = structuredClone(value); throw new Error('before commit') }
    return put.call(this, value, key)
  })
  const pending = actor.confirm(a).catch(error => error)
  await expect(actor.confirm(b)).rejects.toMatchObject({ code: 'busy' })
  await expect(actor.confirm(a)).rejects.toMatchObject({ code: 'busy' })
  expect(await pending).toBeInstanceOf(Error); fault.mockRestore()
  expect(await control()).toEqual(header); expect(attempted).toBeDefined()
  await expect(actor.confirm(b)).rejects.toMatchObject({ code: 'changed' })
  await actor.confirm(a); expect(await control()).toEqual(attempted)
  await expect(oldActor.resume()).rejects.toThrow() // retired migration cannot recopy a superseded journal
  expect(await control()).toEqual(attempted); expect(fetch).not.toHaveBeenCalled()
}, 30_000)

it.each([false, true])('lost CAS acknowledgement accepts only the exact own v6; receipt replaced=%s', async replace => {
  const { a, b } = await interruptedMigration(), actor = (await import('../../services/workspaceWriter/migration')).createColdMigrationErasure()
  await actor.inspect()
  const originalTimeout = setTimeout, put = IDBObjectStore.prototype.put
  let expire!: () => void
  const timeout = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    if (ms === 120_000) expire = fn
    return originalTimeout(fn, ms)
  }) as typeof setTimeout)
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (value.version === 6) this.transaction.addEventListener('complete', () => expire(), { once: true })
    return put.call(this, value, key)
  })
  await expect(actor.confirm(a)).rejects.toMatchObject({ code: 'cancelled' }); fault.mockRestore(); timeout.mockRestore()
  let committed = await control(); expect(committed.version).toBe(6)
  if (replace) {
    committed = { ...committed, revision: committed.revision + 1 }
    const db = await openDB('arty-workspace-control'); await db.put('meta', committed, 'workspace'); db.close()
  }
  const writes = vi.spyOn(IDBObjectStore.prototype, 'put'), before = await rawCopies()
  await expect(actor.confirm(b)).rejects.toThrow()
  if (replace) await expect(actor.confirm(a)).rejects.toThrow()
  else await expect(actor.confirm(a)).resolves.toBeUndefined()
  expect(writes).not.toHaveBeenCalled(); expect(await control()).toEqual(committed); expect(await rawCopies()).toEqual(before)
}, 30_000)

it.each(['fenced', 'plan', 'local', 'native', 'verified', 'ready'])('v3 supersession survives a cold erasure cut before %s without returning to v3 or changing B', async point => {
  const { a, b, savedB } = await interruptedMigration(), actor = (await import('../../services/workspaceWriter/migration')).createColdMigrationErasure()
  await actor.inspect(); await actor.confirm(a)
  const reserved = await control()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('erasure')
  const put = IDBObjectStore.prototype.put
  let cut = false
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (!cut && ((point === 'plan' && this.name === 'journal' && key === 'plan') ||
      (this.transaction.db.name === 'arty-workspace-control' && (value.erasure?.phase === point || (point === 'ready' && value.version === 7))))) {
      cut = true; throw new Error('cold erasure cut')
    }
    return put.call(this, value, key)
  })
  await expect((await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure().resume()).rejects.toThrow()
  fault.mockRestore(); expect(cut).toBe(true)
  expect((await control()).erasure.authority).toEqual(reserved.erasure.authority)
  await cold()
  expect((await control()).resets[0].resetId).toBe(reserved.erasure.reset.resetId)
  const users = await import('../../services/userSession'); users.setActiveSession(account(b)); await (await import('../../services/crypto')).initCrypto('key-b')
  await readAndUpdate(savedB); await writeAndRead(`B-after-cut-${point}`)
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
