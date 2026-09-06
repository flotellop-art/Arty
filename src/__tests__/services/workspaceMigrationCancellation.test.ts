import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB, deleteDB } from 'idb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/workspaceLocks'
import { createDatabaseShape, FILE_SHAPE, PROJECT_SHAPE } from '../../services/workspaceWriter/schema'
import { localPairs, localTargets, RAW_STORES } from '../../services/workspaceWriter/migrationInventory'
import { migrationDatabaseName } from '../../services/workspaceWriter/migrationProtocol'
import { isolatedWorkspaceLayout } from '../../services/workspaceWriter/layout'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) }))
let runtime: typeof import('../../services/workspaceWriter/runtime'), service: typeof import('../../services/workspaceWriter/migration')
let lock: ReturnType<typeof deferred>
async function endDocument() {
  if (runtime?.documentWorkspace.getSnapshot() === 'held') { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request(_n: unknown, _o: unknown, cb: (l: unknown) => Promise<void>) { void cb({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime'); service = await import('../../services/workspaceWriter/migration')
  await runtime.documentWorkspace.acquire()
}
async function control() { const db = await openDB('arty-workspace-control'); try { return await db.get('meta', 'workspace') } finally { db.close() } }
async function journal(header: { generation: string }) { return openDB(migrationDatabaseName(header.generation)) }
async function sources() {
  const rows = []
  for (const name of ['arty-files', 'arty-projects']) {
    const db = await openDB(name)
    try { const stores = []; for (const store of db.objectStoreNames) stores.push([store, await db.getAllKeys(store), await db.getAll(store)]); rows.push([name, db.version, stores]) }
    finally { db.close() }
  }
  return { pairs: localPairs().filter(([key]) => !key.startsWith('arty-workspace:')), rows }
}
async function seed(owner: string | null = 'a') {
  const prefix = owner === null ? 'arty' : `arty-${owner}`
  localStorage.setItem(`${prefix}-crypto-salt`, JSON.stringify(Array(16).fill(7)))
  localStorage.setItem(`${prefix}-conversations-enc-locked`, 'opaque ciphertext \ud800')
  localStorage.setItem(`${prefix}-api-keys`, 'synthetic-access-preserved')
  localStorage.setItem('arty-neighbor-input-draft-enc', 'neighbor-preserved')
  localStorage.setItem('settings', 'untouched')
  const files = await openDB('arty-files', 1, { upgrade(db) { createDatabaseShape(db, FILE_SHAPE) } })
  if (owner !== null) await files.put('files', { fileId: 'f', ownerKey: prefix, encryptedData: 'unreadable', extra: undefined })
  files.close()
  const projects = await openDB('arty-projects', 1, { upgrade(db) { createDatabaseShape(db, PROJECT_SHAPE) } }); projects.close()
}
type Cut = 'reserved' | 'no-journal' | 'no-plan' | 'inventoried' | 'barrier' | 'copied' | 'verified'
async function interrupted(cut: Cut = 'reserved') {
  const original = IDBObjectStore.prototype.put, originalOpen = indexedDB.open.bind(indexedDB)
  const opening = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
    if (cut === 'no-journal' && name.endsWith('-migration') && version === 1) throw new Error('cut')
    return originalOpen(name, version)
  })
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if ((cut === 'no-plan' && this.name === 'journal' && key === 'plan') ||
      (cut === 'reserved' && value.phase === 'inventoried') || (cut === 'inventoried' && value.phase === 'barrier') ||
      (cut === 'barrier' && value.phase === 'copied') || (cut === 'copied' && value.phase === 'verified') || (cut === 'verified' && value.version === 2)) throw new Error('cut')
    return original.call(this, value, key)
  })
  await expect(service.createColdWorkspaceMigration().start()).rejects.toThrow()
  fault.mockRestore(); opening.mockRestore()
  const header = await control()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  return header
}
async function expectTerminal(actor: ReturnType<typeof service.createColdMigrationCancellation>) {
  await expect(actor.inspect()).rejects.toThrow(); await expect(actor.confirm()).rejects.toThrow()
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') })); await newDocument()
})
afterEach(async () => { await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['reserved', 'no-journal', 'no-plan'] as const)('cancels %s with exact sources, small legacy CAS and no private activation', async cut => {
  await seed(); const before = await sources(), header = await interrupted(cut)
  const derive = vi.spyOn(crypto.subtle, 'deriveKey'), decrypt = vi.spyOn(crypto.subtle, 'decrypt')
  const native = await import('../../services/native/coldMailErasure'), nativeCheck = vi.spyOn(native, 'assertNativeErasureOwner')
  const actor = service.createColdMigrationCancellation(), pairs = localPairs()
  expect(await actor.inspect()).toEqual({ initialInventory: cut !== 'reserved' }); expect(localPairs()).toEqual(pairs)
  await actor.confirm(); await expectTerminal(actor)
  expect(await sources()).toEqual(before)
  expect(await control()).toEqual({ format: 'arty-workspace-control', version: 1, layout: 'legacy-v1', state: 'ready', revision: header.revision + 1 })
  expect(localPairs().some(([k]) => k.startsWith('arty-workspace:'))).toBe(false)
  if (cut !== 'no-journal') { const db = await journal(header); expect(await db.getAllKeys('journal')).toEqual(['identity']); for (const name of RAW_STORES) expect(await db.count(name)).toBe(0); db.close() }
  expect(runtime.workspaceAdmission.getSnapshot()).toBe('maintenance'); expect(() => runtime.assertDocumentWorkspace()).toThrow()
  expect(derive).not.toHaveBeenCalled(); expect(decrypt).not.toHaveBeenCalled(); expect(nativeCheck).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready'); expect(runtime.getDocumentStorageLayout().kind).toBe('legacy-v1')
})

it.each([null, 'opaque-\ud800'])('does not require a native-erasable owner: %s', async owner => {
  await seed(owner); const before = await sources(); await interrupted()
  const actor = service.createColdMigrationCancellation(); await actor.inspect(); await actor.confirm(); expect(await sources()).toEqual(before)
})

it.each(['inventoried', 'barrier', 'copied', 'verified'] as const)('refuses %s without mutation', async phase => {
  await seed(); const header = await interrupted(phase), before = await sources(), pairs = localPairs()
  await expect(service.createColdMigrationCancellation().inspect()).rejects.toThrow('workspace_migration_unsupported')
  expect(await control()).toEqual(header); expect(await sources()).toEqual(before); expect(localPairs()).toEqual(pairs)
})

it.each(['physical-v2', 'raw', 'plan', 'identity', 'extra-journal-key', 'source', 'target', 'unknown-copy', 'destination', 'header', 'missing-control'] as const)('rejects changed %s between preview and confirmation', async mutation => {
  await seed(); const header = await interrupted(), actor = service.createColdMigrationCancellation(); await actor.inspect()
  if (mutation === 'physical-v2') { const db = await openDB('arty-files', 2); db.close() }
  if (['raw', 'plan', 'identity', 'extra-journal-key'].includes(mutation)) {
    const db = await journal(header)
    if (mutation === 'raw') await db.put('files', { key: 'foreign', value: 'private-fragment' }, 'foreign')
    else if (mutation === 'plan') { const plan = await db.get('journal', 'plan'); await db.put('journal', { ...plan, owners: ['other'] }, 'plan') }
    else await db.put('journal', 'foreign', mutation === 'identity' ? 'identity' : 'extra')
    db.close()
  }
  if (mutation === 'source') localStorage.setItem('settings', 'new-source')
  if (mutation === 'target') { const db = await journal(header), plan = await db.get('journal', 'plan'); db.close(); localStorage.setItem(localTargets(plan, header.generation)[0][0], 'foreign-copy') }
  if (mutation === 'unknown-copy') localStorage.setItem('arty-workspace:foreign', 'new-copy')
  if (mutation === 'destination') { const layout = isolatedWorkspaceLayout(header.generation, []), db = await openDB(layout.files.name, 1, { upgrade(db) { createDatabaseShape(db, FILE_SHAPE) } }); db.close() }
  if (mutation === 'header') { const db = await openDB('arty-workspace-control'); await db.put('meta', { ...header, revision: header.revision + 1 }, 'workspace'); db.close() }
  if (mutation === 'missing-control') await deleteDB('arty-workspace-control')
  const before = await sources(), pairs = localPairs()
  await expect(actor.confirm()).rejects.toThrow(); await expectTerminal(actor)
  expect(await sources()).toEqual(before); expect(localPairs()).toEqual(pairs)
})

it.each([1, 2])('cut after target removal %i: only exact copies removed, new document/consent required', async at => {
  await seed(); const before = await sources(), header = await interrupted(), actor = service.createColdMigrationCancellation(); await actor.inspect()
  const original = Storage.prototype.removeItem; let count = 0
  const cut = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    original.call(this, key); if (key.startsWith('arty-workspace:') && ++count === at) throw new Error('after removal')
  })
  await expect(actor.confirm()).rejects.toThrow('after removal'); cut.mockRestore(); await expectTerminal(actor)
  expect(await sources()).toEqual(before); expect(await control()).toEqual(header)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  const fresh = service.createColdMigrationCancellation(); expect(await fresh.inspect()).toEqual({ initialInventory: false }); await fresh.confirm()
  expect(await sources()).toEqual(before)
})

it('cut after plan deletion never lets an old actor adopt new source bytes; only fresh current consent can finish', async () => {
  await seed(); const header = await interrupted(), actor = service.createColdMigrationCancellation(); await actor.inspect()
  const original = IDBObjectStore.prototype.delete
  const cut = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === 'journal' && key === 'plan') this.transaction.addEventListener('complete', () => lock.resolve(), { once: true })
    return original.call(this, key)
  })
  await expect(actor.confirm()).rejects.toThrow(); cut.mockRestore()
  const db = await journal(header); expect(await db.getAllKeys('journal')).toEqual(['identity']); db.close()
  localStorage.setItem('settings', 'new-current-source'); const before = await sources()
  await expectTerminal(actor); expect(await control()).toEqual(header)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  const fresh = service.createColdMigrationCancellation(); await expect(fresh.confirm()).rejects.toThrow('workspace_migration_missing'); await expectTerminal(fresh)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
  const confirmed = service.createColdMigrationCancellation(); expect(await confirmed.inspect()).toEqual({ initialInventory: true }); await confirmed.confirm()
  expect(await sources()).toEqual(before)
})

it.each(['raw', 'plan', 'local'] as const)('journal cleanup transaction rejects a concurrent %s mutation', async mutation => {
  await seed(); const header = await interrupted(), actor = service.createColdMigrationCancellation(); await actor.inspect()
  const original = IDBDatabase.prototype.transaction; let injected = false
  const inject = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, names, mode, options) {
    const tx = original.call(this, names, mode, options)
    if (!injected && this.name === migrationDatabaseName(header.generation) && mode === 'readwrite') {
      injected = true
      if (mutation === 'raw') tx.objectStore('files').put({ private: 'late' }, 'late')
      if (mutation === 'plan') tx.objectStore('journal').put({ foreign: true }, 'plan')
      if (mutation === 'local') localStorage.setItem('settings', 'late-source')
    }
    return tx
  })
  await expect(actor.confirm()).rejects.toThrow(); inject.mockRestore(); expect(injected).toBe(true); await expectTerminal(actor)
  expect(await control()).toEqual(header)
  const db = await journal(header); expect(await db.getAllKeys('journal')).toEqual(['identity', 'plan']); db.close()
})

it.each(['before-cas', 'after-cas', 'local-at-cas', 'header-at-cas'] as const)('final %s failure stays terminal without guessing CAS ownership', async cut => {
  await seed(); const header = await interrupted(), actor = service.createColdMigrationCancellation(); await actor.inspect()
  const original = IDBObjectStore.prototype.put, originalTransaction = IDBDatabase.prototype.transaction
  const txSpy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, names, mode, options) {
    const tx = originalTransaction.call(this, names, mode, options)
    if (this.name === 'arty-workspace-control' && mode === 'readwrite') {
      if (cut === 'local-at-cas') localStorage.setItem('settings', 'late-source')
      if (cut === 'header-at-cas') tx.objectStore('meta').put({ ...header, revision: header.revision + 1 }, 'workspace')
    }
    return tx
  })
  const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control' && value.version === 1) {
      if (cut === 'before-cas') throw new Error('before cas')
      if (cut === 'after-cas') this.transaction.addEventListener('complete', () => lock.resolve(), { once: true })
    }
    return original.call(this, value, key)
  })
  await expect(actor.confirm()).rejects.toThrow(); putSpy.mockRestore(); txSpy.mockRestore(); await expectTerminal(actor)
  expect((await control()).version).toBe(cut === 'after-cas' ? 1 : 3)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe(cut === 'after-cas' ? 'ready' : 'recoverable')
})

it('double confirmation and a lost document cannot authorize a late write', async () => {
  await seed(); await interrupted(); const actor = service.createColdMigrationCancellation(); await actor.inspect()
  const running = actor.confirm(); await expect(actor.confirm()).rejects.toThrow('workspace_migration_changed'); await expect(actor.inspect()).rejects.toThrow()
  await running; await expectTerminal(actor)
  await newDocument(); await expect(actor.confirm()).rejects.toThrow()
})
