import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB, deleteDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { File as NodeFile } from 'node:buffer'
import { deferred } from '../helpers/workspaceLocks'
import { createDatabaseShape, FILE_SHAPE, PROJECT_SHAPE } from '../../services/workspaceWriter/schema'
import { migrationDatabaseName } from '../../services/workspaceWriter/migrationProtocol'
import { workspaceDataKey, type IsolatedWorkspaceLayout } from '../../services/workspaceWriter/layout'
import { localPairs } from '../../services/workspaceWriter/migrationInventory'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true }))
const native = vi.hoisted(() => ({ android: false, clear: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.android, getPlatform: () => 'android' },
  registerPlugin: () => ({ clearAccountsForErasure: native.clear }) }))
let runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
const salt = JSON.stringify(Array(16).fill(7)), nonce = '76ba201a-547f-44a1-9000-111111111111', operationId = '76ba201a-547f-44a1-9000-222222222222'
const receipt = (owner = 'a') => ({ owner, operationId, nonce, serverConfirmed: true, pending: [] })
const account = (userId: string) => ({ userId, displayName: userId, authMethod: 'apikey' as const, createdAt: 1 })
async function endDocument() {
  if (runtime?.documentWorkspace.getSnapshot() === 'held') { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request(_n: unknown, _o: unknown, callback: (l: unknown) => Promise<void>) { void callback({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime'); await runtime.documentWorkspace.acquire()
}
async function control() { const db = await openDB('arty-workspace-control', 1); try { return await db.get('meta', 'workspace') } finally { db.close() } }
async function actor() { return (await import('../../services/workspaceWriter/erasure')).createColdWorkspaceErasure() }
async function setReceipt(layout: IsolatedWorkspaceLayout, value: unknown = receipt(), owner = 'a') {
  const db = await openDB(layout.projects.name, 1); await db.put('meta', value, ['erasing', owner]); db.close()
}
async function seed() {
  localStorage.setItem('arty-crypto-salt', salt)
  for (const owner of ['a', 'a-b']) {
    localStorage.setItem(`arty-${owner}-conversations-enc-locked`, `cipher-${owner}`)
    localStorage.setItem(`arty-${owner}-api-keys`, `auth-${owner}`)
    localStorage.setItem(`arty-composer-draft:${owner}:home`, `draft-${owner}`)
  }
  localStorage.setItem('arty-active-session', JSON.stringify(account('a-b')))
  localStorage.setItem('arty-known-sessions', JSON.stringify([account('a'), { ...account('a-b'), extra: 'retained' }]))
  localStorage.setItem('arty-report-global123', 'unattributed-report')
  const files = await openDB('arty-files', 1, { upgrade(db) { createDatabaseShape(db, FILE_SHAPE) } })
  const projects = await openDB('arty-projects', 1, { upgrade(db) { createDatabaseShape(db, PROJECT_SHAPE) } })
  for (const owner of ['a', 'a-b']) {
    await files.put('files', { fileId: owner, ownerKey: `arty-${owner}`, encryptedData: `file-${owner}`, extra: undefined })
    await projects.put('projects', { key: [owner, 'p'], owner, id: 'p', title: `project-${owner}` })
    await projects.put('documents', { key: [owner, 'p', 'd', 'tombstone'], owner, projectId: 'p', id: 'd', kind: 'tombstone', cipher: `doc-${owner}` })
    await projects.put('usage', { owner, projects: 1 })
  }
  files.close(); projects.close()
  const layout = await (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().start()
  // B legitimately changes after cutover: copies must be protected separately.
  const current = await openDB(layout.files.name, 1)
  await current.put('files', { fileId: 'a-b', ownerKey: 'arty-a-b', encryptedData: 'new B data' }); current.close()
  await setReceipt(layout); await newDocument()
  return layout
}
function crash(phase: string) {
  const original = IDBObjectStore.prototype.put
  return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-workspace-control' && (value.erasure?.phase === phase || (phase === 'commit' && value.version === 2))) throw new Error('synthetic-crash')
    return original.call(this, value, key)
  })
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); globalThis.indexedDB = new IDBFactory()
  native.android = false; native.clear.mockReset().mockResolvedValue({ protocol: 1 })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network-forbidden') })); await newDocument()
})
afterEach(async () => { await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('committed generation cold erasure', () => {
  it('real migration → cold admission → all declared A copies/plan/drafts removed, B copies and OAuth untouched', async () => {
    const layout = await seed(), beforeActive = localStorage.getItem('arty-active-session')
    history.replaceState({}, '', '/?code=synthetic#oauth-callback'); sessionStorage.setItem('oauth-state', 'untouched')
    expect(await runtime.workspaceAdmission.admit()).toBe('erasure'); expect(() => runtime.assertDocumentWorkspace()).toThrow()
    const derive = vi.spyOn(crypto.subtle, 'deriveKey')
    await (await actor()).resume()
    expect(derive).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    expect(location.search + location.hash).toBe('?code=synthetic#oauth-callback'); expect(sessionStorage.getItem('oauth-state')).toBe('untouched')
    for (const [name, version, store] of [['arty-files', 2, 'files'], [layout.files.name, 1, 'files'], [migrationDatabaseName(layout.generation), 1, 'files']] as const) {
      const db = await openDB(name, version); expect(await db.get(store, 'a')).toBeUndefined()
      expect((await db.get(store, 'a-b')).encryptedData).toBe(name === layout.files.name ? 'new B data' : 'file-a-b'); db.close()
    }
    for (const name of ['arty-projects', layout.projects.name, migrationDatabaseName(layout.generation)]) {
      const db = await openDB(name)
      expect(await db.get('projects', ['a', 'p'])).toBeUndefined(); expect(await db.get('projects', ['a-b', 'p'])).toBeDefined()
      expect(await db.get('documents', ['a', 'p', 'd', 'tombstone'])).toBeUndefined(); expect(await db.get('usage', 'a')).toBeUndefined()
      expect(await db.get('meta', ['erasing', 'a'])).toBeUndefined(); db.close()
    }
    const job = await openDB(migrationDatabaseName(layout.generation)), plan = await job.get('journal', 'plan'); job.close()
    expect(plan.format).toBe('arty-workspace-redacted'); expect(plan.owners).not.toContain('a'); expect(JSON.stringify(plan)).not.toContain('cipher-a"')
    expect(plan).not.toHaveProperty('stores'); expect(plan).not.toHaveProperty('localHash')
    expect(localStorage.getItem('arty-a-api-keys')).toBeNull(); expect(localStorage.getItem('arty-composer-draft:a:home')).toBeNull()
    expect(localStorage.getItem('arty-composer-draft:a-b:home')).toBe('draft-a-b'); expect(localStorage.getItem('arty-report-global123')).toBe('unattributed-report')
    expect(localStorage.getItem('arty-active-session')).toBe(beforeActive)
    expect(JSON.parse(localStorage.getItem('arty-known-sessions')!)).toEqual([{ ...account('a-b'), extra: 'retained' }])
    expect((await control()).requiredOwners).toContain('a')
    expect(runtime.workspaceAdmission.getSnapshot()).toBe('maintenance')
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  })
  it.each(['local', 'native', 'verified', 'commit'])('resumes after %s including loss of A session and source receipt', async phase => {
    const layout = await seed(), fault = crash(phase)
    await expect((await actor()).resume()).rejects.toThrow('synthetic-crash'); fault.mockRestore()
    const header = await control(); expect(header.version).toBe(4)
    const db = await openDB(layout.projects.name); expect(await db.get('meta', ['erasing', 'a'])).toBeUndefined(); db.close()
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('erasure')
    await (await actor()).resume(); expect((await control()).version).toBe(2)
  })
  it.each(['files', 'projects', 'documents', 'usage', 'meta'])('retries a crash deleting active %s without rebaselining B', async store => {
    const layout = await seed(), original = IDBObjectStore.prototype.delete
    const fault = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
      if ((this.transaction.db.name === layout.projects.name || this.transaction.db.name === layout.files.name) && this.name === store) throw new Error('delete-crash')
      return original.call(this, key)
    })
    await expect((await actor()).resume()).rejects.toThrow('delete-crash'); fault.mockRestore()
    await newDocument(); await (await actor()).resume(); expect((await control()).version).toBe(2)
  })
  it.each(['old-plugin', 'failure', 'wrong-protocol'])('native %s retains receipt and supports explicit retry', async kind => {
    await seed(); native.android = true
    if (kind === 'wrong-protocol') native.clear.mockResolvedValue({ protocol: 0 })
    else native.clear.mockRejectedValue(new Error(kind))
    const worker = await actor(); await expect(worker.resume()).rejects.toThrow()
    expect((await control()).version).toBe(4)
    native.clear.mockResolvedValue({ protocol: 1 }); await worker.resume(); expect((await control()).version).toBe(2)
    expect(native.clear).toHaveBeenLastCalledWith({ scope: 'a' })
  })
  it.each([false, null, { ...receipt(), serverConfirmed: false }])('uncertain/falsy receipt %j refuses before mutation', async value => {
    const layout = await seed(); await setReceipt(layout, value); const before = localPairs(), initial = await control()
    expect(await runtime.workspaceAdmission.admit()).toBe('maintenance')
    expect(() => runtime.assertDocumentWorkspace()).toThrow()
    await newDocument(); await expect((await actor()).resume()).rejects.toThrow()
    expect(await control()).toEqual(initial); expect(localPairs()).toEqual(before)
  })
  it.each(['multiple', 'ambiguous-report', 'ambiguous-draft', 'unknown-draft', 'unknown-generation', 'missing-job'])('refuses %s before reservation or purge', async kind => {
    const layout = await seed()
    if (kind === 'multiple') await setReceipt(layout, receipt('a-b'), 'a-b')
    if (kind === 'ambiguous-report') localStorage.setItem('arty-a-report-conversations', 'ambiguous')
    if (kind === 'ambiguous-draft') localStorage.setItem('arty-composer-draft:a:conversation:home', 'ambiguous')
    if (kind === 'unknown-draft') localStorage.setItem('arty-composer-draft:a:conversation:old-id', 'unknown')
    if (kind === 'unknown-generation') localStorage.setItem('arty-workspace:unknown:[]', 'foreign')
    if (kind === 'missing-job') await deleteDB(migrationDatabaseName(layout.generation))
    const before = localPairs(), initial = await control()
    await expect((await actor()).resume()).rejects.toThrow()
    expect(await control()).toEqual(initial); expect(localPairs()).toEqual(before)
  })
  it.each(['A', 'B'])('rejects %s local change during final phase instead of adopting a new baseline', async changed => {
    await seed(); const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.transaction.db.name === 'arty-workspace-control' && value.erasure?.phase === 'verified') localStorage.setItem(`arty-${changed === 'A' ? 'a' : 'a-b'}-api-keys`, 'late')
      return original.call(this, value, key)
    })
    await expect((await actor()).resume()).rejects.toThrow(); expect((await control()).version).toBe(4)
  })
  it('refuses B tamper after a crash, never overwrites or silently rebaselines', async () => {
    const layout = await seed(), fault = crash('local')
    await expect((await actor()).resume()).rejects.toThrow(); fault.mockRestore()
    const db = await openDB(layout.files.name); await db.put('files', { fileId: 'a-b', ownerKey: 'arty-a-b', encryptedData: 'tampered' }); db.close()
    await newDocument(); await expect((await actor()).resume()).rejects.toThrow(); expect((await control()).version).toBe(4)
  })
  it('keeps a mismatched legacy erasure fence blocked explicitly before mutation', async () => {
    await seed(); localStorage.setItem('arty-project-erasure-fence', 'interrupted-fence')
    const before = localPairs(), initial = await control()
    await expect((await actor()).resume()).rejects.toThrow()
    expect(await control()).toEqual(initial); expect(localPairs()).toEqual(before)
  })
  it('LS quota leaves durable v4 after source receipt removal; retry preserves B', async () => {
    await seed(); const original = Storage.prototype.setItem
    const fault = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'arty-known-sessions') throw new DOMException('full', 'QuotaExceededError')
      original.call(this, key, value)
    })
    const worker = await actor(); await expect(worker.resume()).rejects.toMatchObject({ name: 'QuotaExceededError' }); fault.mockRestore()
    expect((await control()).version).toBe(4)
    await worker.resume(); expect((await control()).version).toBe(2)
    expect(JSON.parse(localStorage.getItem('arty-known-sessions')!)[0].userId).toBe('a-b')
  })
  it('acknowledges its own actually committed final record after timeout, without a second purge', async () => {
    await seed(); const originalTimer = setTimeout, originalPut = IDBObjectStore.prototype.put
    let expire!: () => void
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 120_000) expire = fn
      return originalTimer(fn, ms)
    }) as typeof setTimeout)
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.transaction.db.name === 'arty-workspace-control' && value.version === 2) this.transaction.addEventListener('complete', () => expire(), { once: true })
      return originalPut.call(this, value, key)
    })
    const worker = await actor(); await expect(worker.resume()).rejects.toThrow('workspace_erasure_cancelled'); fault.mockRestore()
    const final = await control(), writes = vi.spyOn(IDBObjectStore.prototype, 'put'), deletes = vi.spyOn(IDBObjectStore.prototype, 'delete')
    expect(final.version).toBe(2); await worker.resume()
    expect(writes).not.toHaveBeenCalled(); expect(deletes).not.toHaveBeenCalled(); expect(await control()).toEqual(final)
  })
  it('retired document cannot finalize after a late native completion', async () => {
    await seed(); native.android = true
    const nativePending = deferred(); native.clear.mockImplementation(async () => { await nativePending.promise; return { protocol: 1 } })
    const worker = await actor(), pending = worker.resume(), rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(native.clear).toHaveBeenCalledOnce()); await endDocument(); await rejected
    nativePending.resolve(); await Promise.resolve(); expect((await control()).version).toBe(4)
    await newDocument(); native.clear.mockResolvedValue({ protocol: 1 }); await (await actor()).resume(); expect((await control()).version).toBe(2)
  })
  it('real B history/file/project still decrypt after A cleanup; post-cutover A cannot create a new salt', async () => {
    expect(await runtime.workspaceAdmission.admit()).toBe('ready')
    let users = await import('../../services/userSession'), crypt = await import('../../services/crypto')
    const storage = await import('../../services/storage'), files = await import('../../services/secureFileStorage')
    users.setActiveSession(account('b')); await crypt.initCrypto('synthetic-b')
    await files.putFile({ id: 'fb', name: 'b.txt', type: 'text/plain', size: 1, data: 'Qg==' })
    const projects = await import('../../services/projects/store'), { prepareProjectDocument } = await import('../../services/projects/documentImport')
    const op = await projects.beginProjectOperation(); let project = await projects.createProject(op, 'B project')
    project = await projects.addProjectDocument(op, project, await prepareProjectDocument(op, new NodeFile(['B source'], 'b.txt', { type: 'text/plain' }) as unknown as File))
    const conversation = { id: 'cb', title: 'B history', createdAt: 1, updatedAt: 1, projectId: project.id, hasProjectContext: true,
      messages: [{ id: 'mb', role: 'user' as const, content: 'B kept', timestamp: 1, files: [{ id: 'fb', name: 'b.txt', type: 'text/plain', size: 1 }] }] }
    storage.saveConversation(conversation); await vi.waitFor(() => expect(localStorage.getItem('arty-b-conversations')).toBeNull())
    await newDocument(); const layout = await (await import('../../services/workspaceWriter/migration')).createColdWorkspaceMigration().start()
    expect(layout.requiredOwners).not.toContain('a')
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
    users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
    users.setActiveSession(account('a')); await crypt.initCrypto('synthetic-a')
    const realProjects = await import('../../services/projects/store'), lease = await realProjects.beginProjectErasure('a', () => runtime.assertDocumentWorkspace())
    await realProjects.confirmServerProjectErasure(lease)
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('erasure'); await (await actor()).resume()
    expect((await control()).requiredOwners).toContain('a'); expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'crypto-salt'))).toBeNull()
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
    users = await import('../../services/userSession'); crypt = await import('../../services/crypto')
    users.setActiveSession(account('b')); await crypt.initCrypto('synthetic-b')
    const history = await import('../../services/storage'); await history.bootstrapConversationStorage()
    expect(history.getConversation('cb')).toEqual(conversation)
    expect((await (await import('../../services/secureFileStorage')).getFile('fb'))?.data).toBe('Qg==')
    const prepared = await (await import('../../services/workspaceBackup/capture')).prepareConversationArchive('cb', { includeProject: true, isBusy: () => false, signal: new AbortController().signal })
    expect(prepared.report).toMatchObject({ conversations: 1, files: 1, projects: 1, documents: 1 }); prepared.dispose()
    users.setActiveSession(account('a')); await expect(crypt.initCrypto('new-a')).rejects.toThrow()
    expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'crypto-salt'))).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
