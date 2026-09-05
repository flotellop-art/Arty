import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB, deleteDB } from 'idb'
import { File as NodeFile } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/workspaceLocks'
import { createDatabaseShape, FILE_SHAPE, PROJECT_SHAPE } from '../../services/workspaceWriter/schema'
import { rawEncoding, digestRaw } from '../../services/workspaceWriter/migrationInventory'
import { migrationDatabaseName } from '../../services/workspaceWriter/migrationProtocol'
import { workspaceDataKey } from '../../services/workspaceWriter/layout'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true }))
let runtime: typeof import('../../services/workspaceWriter/runtime')
let migration: typeof import('../../services/workspaceWriter/migration')
let lock: ReturnType<typeof deferred>
const salt = JSON.stringify(Array(16).fill(7))
const local = () => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]))
async function endDocument() {
  if (runtime?.documentWorkspace.getSnapshot() === 'held') {
    lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true))
  }
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) { void callback({}); return lock.promise },
  } })
  runtime = await import('../../services/workspaceWriter/runtime')
  migration = await import('../../services/workspaceWriter/migration')
  await runtime.documentWorkspace.acquire()
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network allowed') }))
  await newDocument()
})
afterEach(async () => { await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function seed() {
  localStorage.setItem('arty-crypto-salt', salt)
  localStorage.setItem('arty-crypto-check', 'global-not-authoritative')
  localStorage.setItem('arty-crypto-version', 'v2')
  localStorage.setItem('arty-a-conversations-enc-locked', 'opaque ciphertext \ud800')
  localStorage.setItem('arty-a-api-keys', 'synthetic-auth-not-copied')
  localStorage.setItem('unrelated', 'retained')
  const files = await openDB('arty-files', 1, { upgrade(db) { createDatabaseShape(db, FILE_SHAPE) } })
  await files.put('files', { fileId: 'f', ownerKey: 'arty-a', encryptedData: 'unreadable', extra: undefined }); files.close()
  const projects = await openDB('arty-projects', 1, { upgrade(db) { createDatabaseShape(db, PROJECT_SHAPE) } })
  await projects.put('documents', { key: ['a-b', 'p', 'd', 'tombstone'], owner: 'a-b', projectId: 'p', id: 'd', kind: 'tombstone', state: 'deleted', cipher: null, extra: '' })
  await projects.put('usage', { owner: 'a-b', projects: 0, documents: 0, sourceBytes: 0 }); projects.close()
}
async function control() {
  const db = await openDB('arty-workspace-control', 1), value = await db.get('meta', 'workspace'); db.close(); return value
}
function crashOpen(name: string, version?: number) {
  const original = indexedDB.open.bind(indexedDB)
  return vi.spyOn(indexedDB, 'open').mockImplementation((n, v) => {
    if (n === name && (version === undefined || v === version)) throw new Error('synthetic interruption')
    return original(n, v)
  })
}
function crashPhase(phase: string) {
  const original = IDBObjectStore.prototype.put
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control' && (value.phase === phase || (phase === 'commit' && value.version === 2))) throw new Error('synthetic interruption')
    return original.call(this, value, key)
  })
}
describe('cold raw migration candidate: real IDB journal, barriers and admission', () => {
  it('excludes private admission positively, including a previously pending admission', async () => {
    const actor = migration.createColdWorkspaceMigration()
    expect(await runtime.workspaceAdmission.admit()).toBe('maintenance')
    expect(() => runtime.assertDocumentWorkspace()).toThrow()
    expect(() => migration.createColdWorkspaceMigration()).toThrow()
    await actor.start()
    expect(await runtime.workspaceAdmission.admit()).toBe('maintenance')
    await newDocument()
    const pending = runtime.workspaceAdmission.admit()
    expect(() => migration.createColdWorkspaceMigration()).toThrow()
    expect(await pending).toBe('ready')
  })
  it('preserves raw slots, orphan/deleted rows, missing own check, credentials and source; fresh reader selects the real generation', async () => {
    await seed(); const before = local()
    const layout = await migration.createColdWorkspaceMigration().start()
    expect(layout.requiredOwners).toEqual(expect.arrayContaining([null, 'a', 'a-b']))
    expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'crypto-salt'))).toBe(salt)
    expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'crypto-check'))).toBeNull()
    expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'conversations-enc-locked'))).toBe(before['arty-a-conversations-enc-locked'])
    for (const [key, value] of Object.entries(before)) expect(localStorage.getItem(key)).toBe(value)
    const job = await openDB(migrationDatabaseName(layout.generation), 1)
    const plan = await job.get('journal', 'plan')
    expect(JSON.stringify(plan)).not.toContain('synthetic-auth-not-copied')
    const file = await job.get('files', 'f'); expect(Object.hasOwn(file, 'extra')).toBe(true)
    expect(await job.count('documents')).toBe(1); job.close()
    expect((await indexedDB.databases()).filter(d => d.name === 'arty-files' || d.name === 'arty-projects').every(d => d.version === 2)).toBe(true)
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
    expect(runtime.getDocumentStorageLayout()).toEqual(layout); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['inventoried', 'barrier', 'copied', 'verified', 'commit'])('resumes after an interruption before %s using the same generation and byte verification', async phase => {
    await seed(); const fault = crashPhase(phase)
    await expect(migration.createColdWorkspaceMigration().start()).rejects.toThrow('synthetic interruption')
    fault.mockRestore(); const before = await control()
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
    expect(runtime.workspaceAdmission.getRecovery()?.generation).toBe(before.generation)
    const layout = await migration.createColdWorkspaceMigration().resume()
    expect(layout.generation).toBe(before.generation); expect((await control()).version).toBe(2)
  })
  it('recovers reserved control before job creation, and Files v2/Projects v1 after first barrier', async () => {
    await seed()
    const original = indexedDB.open.bind(indexedDB)
    const stopJob = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      if (name.endsWith('-migration') && version === 1) throw new Error('job-not-created')
      return original(name, version)
    })
    const actor = migration.createColdWorkspaceMigration()
    await expect(actor.start()).rejects.toThrow('job-not-created'); stopJob.mockRestore()
    expect((await control()).phase).toBe('reserved')
    const stopProjects = crashOpen('arty-projects', 2)
    await expect(actor.resume()).rejects.toThrow(); stopProjects.mockRestore()
    expect(await indexedDB.databases()).toEqual(expect.arrayContaining([{ name: 'arty-files', version: 2 }, { name: 'arty-projects', version: 1 }]))
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('recoverable')
    expect((await migration.createColdWorkspaceMigration().resume()).kind).toBe('isolated-v1')
  })
  it.each(['missing', 'foreign'])('refuses %s journal after an attested inventory without recreating it', async kind => {
    await seed(); const fault = crashPhase('barrier')
    await expect(migration.createColdWorkspaceMigration().start()).rejects.toThrow(); fault.mockRestore()
    const header = await control(), name = migrationDatabaseName(header.generation)
    if (kind === 'missing') await deleteDB(name)
    else { const db = await openDB(name, 1); await db.put('journal', { foreign: true }, 'identity'); db.close() }
    await newDocument()
    await expect(migration.createColdWorkspaceMigration().resume()).rejects.toMatchObject({ code: kind === 'missing' ? 'missing' : 'collision' })
    expect(await control()).toEqual(header)
  })
  it.each(['credential', 'unknown-add', 'source-delete', 'target'])('detects %s change even after copy, without excluding a broad LS prefix', async kind => {
    await seed(); const fault = crashPhase('commit'), actor = migration.createColdWorkspaceMigration()
    await expect(actor.start()).rejects.toThrow(); fault.mockRestore()
    if (kind === 'credential') localStorage.setItem('arty-a-api-keys', 'changed')
    if (kind === 'unknown-add') localStorage.setItem('unknown-new', '')
    if (kind === 'source-delete') localStorage.removeItem('unrelated')
    if (kind === 'target') localStorage.setItem(Object.keys(localStorage).find(k => k.startsWith('arty-workspace:'))!, 'changed')
    await expect(actor.resume()).rejects.toMatchObject({ code: 'changed' })
    expect((await control()).version).toBe(3)
  })
  it.each(['anonymous-file', 'wrong-owner', 'typed-value', 'missing-salt', 'empty-salt', 'invalid-session', 'too-long-owner', 'pending-erase', 'falsy-erase', 'fence', 'ambiguous-report'])('refuses %s before any durable reservation/barrier', async kind => {
    await seed()
    if (kind === 'missing-salt') localStorage.removeItem('arty-crypto-salt')
    if (kind === 'empty-salt') localStorage.setItem('arty-a-crypto-salt', '')
    if (kind === 'invalid-session') localStorage.setItem('arty-known-sessions', '{broken')
    if (kind === 'too-long-owner') localStorage.setItem(`arty-${'a'.repeat(129)}-conversations`, '')
    if (kind === 'ambiguous-report') localStorage.setItem('arty-owner-report-theme', 'ambiguous authority')
    const db = await openDB(kind === 'anonymous-file' || kind === 'typed-value' ? 'arty-files' : 'arty-projects', 1)
    if (kind === 'anonymous-file') await db.put('files', { fileId: 'anon', ownerKey: 'arty-anon' })
    if (kind === 'typed-value') await db.put('files', { fileId: 'typed', ownerKey: 'arty-a', extra: new Uint8Array([1]) })
    if (kind === 'wrong-owner') await db.put('projects', { key: ['a', 'p'], owner: 'b', id: 'p' })
    if (kind === 'pending-erase' || kind === 'falsy-erase') await db.put('meta', kind === 'falsy-erase' ? false : { serverConfirmed: false }, ['erasing', 'a'])
    if (kind === 'fence') await db.put('meta', 'different', 'erasure-fence')
    db.close(); const before = local()
    await expect(migration.createColdWorkspaceMigration().start()).rejects.toBeInstanceOf(Error)
    expect(local()).toEqual(before)
    expect((await indexedDB.databases()).every(d => d.version === 1 && d.name !== 'arty-workspace-control')).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('LS quota occurs before barriers; retained partial copy and journal allow an explicit retry', async () => {
    await seed(); const original = Storage.prototype.setItem; let writes = 0
    const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('arty-workspace:') && ++writes === 2) throw new DOMException('full', 'QuotaExceededError')
      original.call(this, key, value)
    })
    const actor = migration.createColdWorkspaceMigration()
    await expect(actor.start()).rejects.toMatchObject({ name: 'QuotaExceededError' }); quota.mockRestore()
    expect((await control()).phase).toBe('reserved')
    expect((await indexedDB.databases()).filter(d => d.name === 'arty-files' || d.name === 'arty-projects').every(d => d.version === 1)).toBe(true)
    await actor.resume(); expect((await control()).version).toBe(2)
  })
  it('bounds and retires a blocked legacy upgrade: releasing old client cannot upgrade after the failed attempt', async () => {
    await seed(); const blocking = await openDB('arty-files', 1), actor = migration.createColdWorkspaceMigration()
    await expect(actor.start()).rejects.toMatchObject({ code: 'storage' })
    blocking.close()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect((await indexedDB.databases()).find(d => d.name === 'arty-files')?.version).toBe(1)
    await actor.resume(); expect((await control()).version).toBe(2)
  })
  it('a newly unsupported source after preflight is refused after the real barriers, never silently admitted', async () => {
    await seed(); const original = indexedDB.open.bind(indexedDB)
    vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      if (name === 'arty-files' && version === 2) localStorage.setItem('arty-new-owner-conversations', 'new source without own salt')
      return original(name, version)
    })
    await expect(migration.createColdWorkspaceMigration().start()).rejects.toMatchObject({ code: 'changed' })
    expect((await control()).version).toBe(3)
    expect((await indexedDB.databases()).find(d => d.name === 'arty-files')?.version).toBe(2)
    expect(localStorage.getItem('arty-new-owner-conversations')).toBe('new source without own salt')
  })
  it('target divergence is never overwritten by a resumed raw copy', async () => {
    await seed(); const fault = crashPhase('verified'), actor = migration.createColdWorkspaceMigration()
    await expect(actor.start()).rejects.toThrow(); fault.mockRestore()
    const header = await control(), db = await openDB(`arty-workspace-${header.generation}-files`, 1)
    const changed = { fileId: 'f', ownerKey: 'arty-a', encryptedData: 'concurrent-target-change' }
    await db.put('files', changed)
    await expect(actor.resume()).rejects.toMatchObject({ code: 'changed' })
    expect(await db.get('files', 'f')).toEqual(changed); db.close()
    expect(await control()).toEqual(header)
  })
  it('opaque anon and delimiter-bearing local owners stay distinct from anonymous data', async () => {
    await seed()
    for (const owner of ['anon', 'null', 'a:[]"', 'é', 'Å', 'report-person']) localStorage.setItem(`arty-${owner}-conversations-enc-locked`, owner)
    localStorage.setItem('arty-report-settings-only-theme', 'dark')
    vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => { throw new Error('Locale must not determine journal order') })
    const layout = await migration.createColdWorkspaceMigration().start()
    for (const owner of ['anon', 'null', 'a:[]"', 'é', 'Å', 'report-person']) expect(localStorage.getItem(workspaceDataKey(layout, owner, 'conversations-enc-locked'))).toBe(owner)
    expect(layout.requiredOwners).toContain('report-settings-only')
    expect(localStorage.getItem(workspaceDataKey(layout, null, 'conversations-enc-locked'))).toBeNull()
  })
  it.each(['local-memory-facts', 'custom-instructions', 'api-keys', 'google-tokens-enc', 'report-76ba201a-547f-44a1-9000-111111111111', 'report-legacy123'])('orphan owner found only in %s retains its effective salt without copying that value', async slot => {
    localStorage.setItem('arty-crypto-salt', salt)
    localStorage.setItem(`arty-orphan-${slot}`, 'private-settings-bytes')
    const layout = await migration.createColdWorkspaceMigration().start()
    expect(layout.requiredOwners).toContain('orphan')
    expect(localStorage.getItem(workspaceDataKey(layout, 'orphan', 'crypto-salt'))).toBe(salt)
    const db = await openDB(migrationDatabaseName(layout.generation), 1)
    expect(JSON.stringify(await db.get('journal', 'plan'))).not.toContain('private-settings-bytes'); db.close()
    expect(localStorage.getItem(`arty-orphan-${slot}`)).toBe('private-settings-bytes')
  })
  it('acknowledges an actually committed v2 after timeout without a second copy or endless missing-journal retry', async () => {
    await seed()
    const originalTimeout = setTimeout, originalPut = IDBObjectStore.prototype.put
    let expire!: () => void
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 120_000) expire = fn
      return originalTimeout(fn, ms)
    }) as typeof setTimeout)
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.transaction.db.name === 'arty-workspace-control' && value.version === 2) this.transaction.addEventListener('complete', () => expire(), { once: true })
      return originalPut.call(this, value, key)
    })
    const actor = migration.createColdWorkspaceMigration()
    await expect(actor.start()).rejects.toMatchObject({ code: 'cancelled' }); fault.mockRestore()
    const committed = await control(); expect(committed.version).toBe(2)
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put'), localBefore = local()
    const layout = await actor.resume()
    expect(layout.generation).toBe(committed.generation); expect(local()).toEqual(localBefore); expect(writes).not.toHaveBeenCalled()
  })
  it.each([true, false])('session-only owner is inventoried: global salt present=%s, no invented key or dropped authority', async hasSalt => {
    const session = { userId: 'session-only', displayName: 'Synthetic', authMethod: 'apikey', createdAt: 1 }
    localStorage.setItem('arty-active-session', JSON.stringify(session))
    localStorage.setItem('arty-known-sessions', JSON.stringify([session]))
    localStorage.setItem('arty-session-only-api-keys', JSON.stringify({ anthropic: 'synthetic' }))
    if (hasSalt) localStorage.setItem('arty-crypto-salt', salt)
    const before = local(), actor = migration.createColdWorkspaceMigration()
    if (!hasSalt) {
      await expect(actor.start()).rejects.toMatchObject({ code: 'unsupported' })
      expect(await indexedDB.databases()).toEqual([]); expect(local()).toEqual(before)
    } else {
      const layout = await actor.start()
      expect(layout.requiredOwners).toContain('session-only')
      expect(localStorage.getItem(workspaceDataKey(layout, 'session-only', 'crypto-salt'))).toBe(salt)
      await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
      const crypt = await import('../../services/crypto')
      await crypt.initCrypto('synthetic'); expect(crypt.isCryptoReady()).toBe(true)
      expect(await crypt.selfTestCrypto()).toBe(false) // no invented check
      expect(localStorage.getItem('arty-session-only-api-keys')).toBe(before['arty-session-only-api-keys'])
    }
  })
  it('new cold document reads actual encrypted history and attachment after migration, supports wrong-key recovery and A-B-A', async () => {
    expect(await runtime.workspaceAdmission.admit()).toBe('ready')
    let users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
    let history = await import('../../services/storage'), files = await import('../../services/secureFileStorage')
    const account = (userId: string) => ({ userId, displayName: userId, authMethod: 'apikey' as const, createdAt: 1 })
    users.setActiveSession(account('a')); await crypt.initCrypto('synthetic-a')
    await files.putFile({ id: 'f', name: 'a.txt', type: 'text/plain', size: 1, data: 'QQ==' })
    const projects = await import('../../services/projects/store'), { prepareProjectDocument } = await import('../../services/projects/documentImport')
    const op = await projects.beginProjectOperation()
    let project = await projects.createProject(op, 'Source project')
    project = await projects.addProjectDocument(op, project, await prepareProjectDocument(op, new NodeFile(['Exact source'], 'source.txt', { type: 'text/plain' }) as unknown as File))
    const conversation = { id: 'c', title: 'Exact', createdAt: 1, updatedAt: 1, projectId: project.id, hasProjectContext: true,
      messages: [{ id: 'm', role: 'user' as const, content: 'Hello', timestamp: 1, files: [{ id: 'f', name: 'a.txt', type: 'text/plain', size: 1 }] }] }
    history.saveConversation(conversation)
    await vi.waitFor(() => expect(localStorage.getItem('arty-a-conversations')).toBeNull())
    const legacyBytes = local()
    await newDocument(); await migration.createColdWorkspaceMigration().start()
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
    users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
    history = await import('../../services/storage'); files = await import('../../services/secureFileStorage')
    await crypt.initCrypto('synthetic-a'); await history.bootstrapConversationStorage()
    expect(history.getConversation('c')).toEqual(conversation); expect((await files.getFile('f'))?.data).toBe('QQ==')
    const { prepareConversationArchive } = await import('../../services/workspaceBackup/capture')
    const prepared = await prepareConversationArchive('c', { includeProject: true, isBusy: () => false, signal: new AbortController().signal })
    expect(prepared.report).toMatchObject({ conversations: 1, files: 1, projects: 1, documents: 1 })
    expect((await prepared.verify(prepared.archive, prepared.recoveryCode)).fingerprint).toBe(prepared.report.fingerprint)
    prepared.dispose()
    users.setActiveSession(account('b')); await crypt.initCrypto('synthetic-b'); await history.bootstrapConversationStorage()
    expect(history.getConversations()).toEqual([]); expect(await files.getFile('f')).toBeNull()
    users.setActiveSession(account('a')); await crypt.initCrypto('wrong'); expect(await crypt.selfTestCrypto()).toBe(false)
    await history.bootstrapConversationStorage(); await crypt.initCrypto('synthetic-a'); await history.bootstrapConversationStorage()
    expect(history.getConversation('c')).toEqual(conversation)
    for (const [key, value] of Object.entries(legacyBytes).filter(([k]) => k.startsWith('arty-a-crypto') || k.startsWith('arty-a-conversations'))) expect(localStorage.getItem(key)).toBe(value)
  })
})
it('canonical digests preserve empty, undefined, negative zero and unpaired surrogates, and reject lossy exotic forms', async () => {
  const values = [undefined, null, '', 0, -0, '\ud800', '\ufffd']
  expect(new Set(await Promise.all(values.map(digestRaw))).size).toBe(values.length)
  for (const value of [new Date(), new Map(), new Uint8Array(), { get secret() { throw new Error('must not invoke') } }]) expect(() => rawEncoding(value)).toThrow('workspace_migration_unsupported')
})
