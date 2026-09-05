import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB, deleteDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { File as NodeFile } from 'node:buffer'
import { deferred } from '../helpers/workspaceLocks'
import { createDatabaseShape, FILE_SHAPE, PROJECT_SHAPE } from '../../services/workspaceWriter/schema'
import { migrationDatabaseName } from '../../services/workspaceWriter/migrationProtocol'
import { workspaceDataKey, type IsolatedWorkspaceLayout } from '../../services/workspaceWriter/layout'
import { localPairs, digestRaw, digestText, RAW_STORES } from '../../services/workspaceWriter/migrationInventory'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true }))
const native = vi.hoisted(() => ({ android: false, clear: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.android, getPlatform: () => 'android' },
  registerPlugin: () => ({ clearAccountsForErasure: native.clear }) }))
let runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
const salt = JSON.stringify(Array(16).fill(7)), nonce = '76ba201a-547f-44a1-9000-111111111111', operationId = '76ba201a-547f-44a1-9000-222222222222'
const receipt = (owner = 'a') => ({ owner, operationId, nonce, serverConfirmed: true, pending: [] })
const remoteReceipt = (state: 'uncertain' | 'not-sent' = 'uncertain') => ({ ...receipt(), serverConfirmed: false,
  remote: { protocol: 1 as const, kind: 'email-trial' as const, capability: 'c'.repeat(64), subjectHash: 'd'.repeat(64), state } })
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
/** Independent old-format fixture: no call into the new erasure writer or
 * erasureLocalSnapshot. The v4 domain includes BOTH raw fence locations. */
async function reserveHistoricalV4(layout: IsolatedWorkspaceLayout) {
  const initial = await control(), stores = []
  for (const [copy, filesName, projectsName] of [['legacy', 'arty-files', 'arty-projects'], ['active', layout.files.name, layout.projects.name], ['journal', migrationDatabaseName(layout.generation), migrationDatabaseName(layout.generation)]]) {
    for (const store of RAW_STORES) {
      const db = await openDB(store === 'files' ? filesName! : projectsName!), tx = db.transaction(store)
      let cursor = await tx.store.openCursor(), count = 0
      // Read before async hashes: the readonly transaction must remain alive.
      const rows = []
      while (cursor) { rows.push([cursor.key, cursor.value]); cursor = await cursor.continue() }
      await tx.done; db.close()
      let hash = await digestText('arty-erasure-protected-store-v1')
      for (const [key, value] of rows) {
        if (value.owner === 'a' || value.ownerKey === 'arty-a') continue
        hash = await digestText(JSON.stringify([hash, await digestRaw([key, value])])) ; count++
      }
      stores.push({ copy, store, hash, count })
    }
  }
  const job = await openDB(migrationDatabaseName(layout.generation)), plan = await job.get('journal', 'plan'); job.close()
  const redacted = { format: 'arty-workspace-redacted', version: 2, owners: plan.owners.filter((o: unknown) => o !== 'a'),
    localSource: plan.localSource.filter(([key]: [string]) => key !== 'arty-a-conversations-enc-locked') }
  const ownKeys = ['arty-a-conversations-enc-locked', 'arty-a-api-keys', 'arty-composer-draft:a:home', workspaceDataKey(layout, 'a', 'conversations-enc-locked'), workspaceDataKey(layout, 'a', 'crypto-salt')]
  const pairs = localPairs().filter(([key]) => !ownKeys.includes(key)).map(([key, value]) => [key, key === 'arty-known-sessions' ? JSON.stringify(JSON.parse(value).filter((s: { userId: string }) => s.userId !== 'a')) : value])
  const v4 = { format: 'arty-workspace-control', version: 4, layout: 'isolated-v1', state: 'erasing', revision: initial.revision + 1, generation: layout.generation, requiredOwners: initial.requiredOwners,
    erasure: { owner: 'a', operationId, nonce, phase: 'reserved', proof: { stores, localHash: await digestRaw(pairs), planHash: await digestRaw(redacted) } } }
  const db = await openDB('arty-workspace-control'); await db.put('meta', v4, 'workspace'); db.close()
  return v4
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
    expect(await runtime.workspaceAdmission.admit()).toBe(value ? 'erasure' : 'maintenance')
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
  it('reserves v5 before repairing a v2 fence, then returns to v2', async () => {
    const layout = await seed(); localStorage.setItem('arty-project-erasure-fence', 'interrupted-fence')
    const fault = crash('fenced')
    await expect((await actor()).resume()).rejects.toThrow('synthetic-crash'); fault.mockRestore()
    const h = await control(); expect(h.version).toBe(5); expect(h.erasure.phase).toBe('reserved')
    const db = await openDB(layout.projects.name)
    expect(await db.get('projects', ['a', 'p'])).toBeDefined()
    expect(await db.get('meta', 'erasure-fence')).toBe(h.erasure.fence.target); db.close()
    expect(localStorage.getItem('arty-project-erasure-fence')).toBe(h.erasure.fence.target)
    await newDocument(); await (await actor()).resume(); expect((await control()).version).toBe(2)
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
  it.each(['coherent', 'aborted-purge'])('real %s → new document recovery → B history/file/project decrypt AND project writes commit', async scenario => {
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
    if (scenario === 'aborted-purge') {
      const db = await openDB(layout.projects.name), oldFence = await db.get('meta', 'erasure-fence'), oldReceipt = await db.get('meta', ['erasing', 'a'])
      let tx: IDBTransaction | undefined, aborted = false
      const put = IDBObjectStore.prototype.put, set = Storage.prototype.setItem
      const putFault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
        if (this.transaction.db.name === layout.projects.name && this.name === 'meta' && key === 'erasure-fence') {
          tx = this.transaction; tx.addEventListener('abort', () => { aborted = true }, { once: true })
        }
        return put.call(this, value, key)
      })
      const setFault = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        set.call(this, key, value)
        if (key === 'arty-project-erasure-fence' && tx) tx.abort()
      })
      users.removeKnownSession('a')
      await expect(realProjects.purgeProjectsForAccount('a', () => runtime.assertDocumentWorkspace())).rejects.toThrow()
      expect(aborted).toBe(true); expect(await db.get('meta', 'erasure-fence')).toEqual(oldFence)
      expect(localStorage.getItem('arty-project-erasure-fence')).not.toBe(oldFence ?? 'initial')
      expect(await db.get('meta', ['erasing', 'a'])).toEqual(oldReceipt); db.close(); putFault.mockRestore(); setFault.mockRestore()
      users.setActiveSession(account('b')); await crypt.initCrypto('synthetic-b')
      expect(crypt.isCryptoReady()).toBe(true); expect(users.getKnownSessions().map(s => s.userId)).toContain('b')
      await expect(realProjects.beginProjectOperation()).rejects.toMatchObject({ code: 'cancelled' })
    }
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
    const reopened = await import('../../services/projects/store'), writeOp = await reopened.beginProjectOperation()
    let newProject = await reopened.createProject(writeOp, 'B after recovery')
    newProject = await reopened.updateProject(writeOp, newProject, { name: 'B committed update', instructions: 'Still writable' })
    expect(newProject.revision).toBe(2)
    expect(await reopened.getProject(writeOp, newProject.id)).toMatchObject({ status: 'ready', revision: 2, project: newProject })
    users.setActiveSession(account('a')); await expect(crypt.initCrypto('new-a')).rejects.toThrow()
    expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'crypto-salt'))).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['coherent', 'divergent'])('independent historical v4 %s retains the original proof and never upgrades', async kind => {
    const layout = await seed(), db = await openDB(layout.projects.name)
    await db.put('meta', 'old-fence', 'erasure-fence'); db.close(); localStorage.setItem('arty-project-erasure-fence', 'old-fence')
    const header = await reserveHistoricalV4(layout)
    if (kind === 'divergent') localStorage.setItem('arty-project-erasure-fence', 'different')
    await newDocument()
    const put = vi.spyOn(IDBObjectStore.prototype, 'put'), remove = vi.spyOn(IDBObjectStore.prototype, 'delete')
    if (kind === 'coherent') { await (await actor()).resume(); expect((await control()).version).toBe(2) }
    else { await expect((await actor()).resume()).rejects.toThrow(); expect(put).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(await control()).toEqual(header) }
  })
  it('cold uncertain GET confirms exact record durably before any purge; retry never GETs or POSTs again', async () => {
    const layout = await seed(), r = remoteReceipt(); await setReceipt(layout, r)
    expect(await runtime.workspaceAdmission.admit()).toBe('erasure'); expect(runtime.workspaceAdmission.getErasureMode()).toBe('uncertain')
    const fetcher = vi.fn(async (_url, init) => {
      expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error' })
      expect(Object.keys(init.headers).sort()).toEqual(['x-arty-erasure-capability', 'x-arty-erasure-operation'])
      return Response.json({ protocol: 1, operationId, subjectHash: r.remote.subjectHash, status: 'confirmed' })
    }); vi.stubGlobal('fetch', fetcher)
    const fault = crash('reserved'), derive = vi.spyOn(crypto.subtle, 'deriveKey')
    await expect((await actor()).resume()).rejects.toThrow('synthetic-crash'); fault.mockRestore()
    const db = await openDB(layout.projects.name); expect(await db.get('meta', ['erasing', 'a'])).toEqual(receipt())
    expect(await db.get('projects', ['a', 'p'])).toBeDefined(); db.close()
    expect(derive).not.toHaveBeenCalled(); await newDocument(); await (await actor()).resume(); expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['unknown', 'html', '401', 'oversized'])('cold receipt %s leaves the complete intent and data intact', async kind => {
    const layout = await seed(), r = remoteReceipt(); await setReceipt(layout, r)
    const initial = await control(), before = localPairs()
    vi.stubGlobal('fetch', vi.fn(async () => kind === '401' ? new Response('{}', { status: 401 }) : kind === 'html' ? new Response('<html>App</html>') :
      kind === 'oversized' ? new Response('x'.repeat(513)) : Response.json({ protocol: 1, operationId, status: 'unknown' })))
    await expect((await actor()).resume()).rejects.toThrow(); expect(await control()).toEqual(initial); expect(localPairs()).toEqual(before)
    const db = await openDB(layout.projects.name); expect(await db.get('meta', ['erasing', 'a'])).toEqual(r); expect(await db.get('projects', ['a', 'p'])).toBeDefined(); db.close()
  })
  it.each(['nonce', 'capability', 'subject', 'kind', 'second-receipt', 'control', 'document'])('cold GET cannot confirm or purge after %s changes', async change => {
    const layout = await seed(), r = remoteReceipt(); await setReceipt(layout, r)
    const response = deferred(), fetcher = vi.fn(async () => { await response.promise; return Response.json({ protocol: 1, operationId, subjectHash: r.remote.subjectHash, status: 'confirmed' }) })
    vi.stubGlobal('fetch', fetcher)
    const pending = (await actor()).resume(), rejected = expect(pending).rejects.toThrow()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    if (change === 'document') await endDocument()
    else if (change === 'control') { const db = await openDB('arty-workspace-control'); const h = await db.get('meta', 'workspace'); await db.put('meta', { ...h, revision: h.revision + 1 }, 'workspace'); db.close() }
    else if (change === 'second-receipt') await setReceipt(layout, receipt('a-b'), 'a-b')
    else await setReceipt(layout, change === 'nonce' ? { ...r, nonce: crypto.randomUUID() } : { ...r, remote: { ...r.remote, ...(change === 'kind' ? { kind: 'google' } : change === 'subject' ? { subjectHash: 'e'.repeat(64) } : { capability: 'e'.repeat(64) }) } })
    response.resolve(); await rejected
    const db = await openDB(layout.projects.name); expect((await db.get('meta', ['erasing', 'a'])).serverConfirmed).toBe(false); expect(await db.get('projects', ['a', 'p'])).toBeDefined(); db.close()
  })
  it.each(['not-sent', 'legacy-unknown', 'local-only'])('%s can finish an explicitly local cleanup without claiming server success', async kind => {
    const layout = await seed(), r = kind === 'legacy-unknown' ? { ...receipt(), serverConfirmed: false } : { ...remoteReceipt('not-sent'), ...(kind === 'local-only' ? { localOnly: true as const } : {}) }
    await setReceipt(layout, r); native.android = true; native.clear.mockRejectedValue(new Error('native unavailable'))
    await expect((await actor()).resume(kind === 'local-only' ? 'resume' : 'local-only')).rejects.toThrow()
    const h = await control(); expect(h.version).toBe(5); expect(h.erasure.authority).toEqual({ ...r, localOnly: true }); expect(h.erasure.authority.serverConfirmed).toBe(false)
    await newDocument(); native.clear.mockResolvedValue({ protocol: 1 }); await (await actor()).resume()
    expect((await control()).version).toBe(2); expect(JSON.stringify(await control())).not.toContain('capability'); expect(fetch).not.toHaveBeenCalled()
  })
  it('uncertain explicit local erasure keeps its LAST remote secret through native failure and document loss', async () => {
    const layout = await seed(), r = remoteReceipt(); await setReceipt(layout, r)
    native.android = true; native.clear.mockRejectedValue(new Error('native unavailable'))
    await expect((await actor()).resume('local-only')).rejects.toThrow()
    const h = await control(); expect(h.erasure.authority.remote).toEqual(r.remote)
    const db = await openDB(layout.projects.name); expect(await db.get('meta', ['erasing', 'a'])).toBeUndefined(); db.close()
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('erasure'); expect(runtime.workspaceAdmission.getErasureMode()).toBe('local-only')
    native.clear.mockResolvedValue({ protocol: 1 }); await (await actor()).resume(); expect(fetch).not.toHaveBeenCalled()
  })
  it('not-sent cancellation changes only the exact marker, never purges or sends a request', async () => {
    const layout = await seed(); await setReceipt(layout, remoteReceipt('not-sent'))
    const before = localPairs(), h = await control()
    await (await actor()).resume('cancel-not-sent'); expect(await control()).toEqual(h); expect(localPairs()).toEqual(before); expect(fetch).not.toHaveBeenCalled()
    const db = await openDB(layout.projects.name); expect(await db.get('projects', ['a', 'p'])).toBeDefined(); expect(await db.get('meta', ['erasing', 'a'])).toBeUndefined(); db.close()
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  })
  it.each(['uncertain', 'local-only', 'legacy-unknown', 'mismatch'])('never cancels %s as a not-sent request', async kind => {
    const layout = await seed(), r = kind === 'legacy-unknown' ? { ...receipt(), serverConfirmed: false } : { ...remoteReceipt(kind === 'uncertain' ? 'uncertain' : 'not-sent'), ...(kind === 'local-only' ? { localOnly: true as const } : {}) }
    await setReceipt(layout, r); if (kind === 'mismatch') localStorage.setItem('arty-project-erasure-fence', 'interrupted')
    await expect((await actor()).resume('cancel-not-sent')).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled()
    const db = await openDB(layout.projects.name); expect(await db.get('meta', ['erasing', 'a'])).toEqual(r); db.close()
  })
  it.each(['before-action', 'between-retries'])('local consent refuses a replacement owner %s', async moment => {
    const layout = await seed(); await setReceipt(layout, remoteReceipt())
    expect(await runtime.workspaceAdmission.admit()).toBe('erasure')
    const worker = await actor()
    if (moment === 'between-retries') await expect(worker.resume()).rejects.toThrow('network-forbidden')
    const db = await openDB(layout.projects.name); await db.delete('meta', ['erasing', 'a']); await db.put('meta', { ...remoteReceipt(), owner: 'a-b' }, ['erasing', 'a-b'])
    const remove = vi.spyOn(IDBObjectStore.prototype, 'delete'), put = vi.spyOn(IDBObjectStore.prototype, 'put')
    await expect(worker.resume('local-only')).rejects.toThrow(); expect(remove).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled()
    expect(await db.get('projects', ['a-b', 'p'])).toBeDefined(); db.close()
  })
  it('recognizes only its own committed not-sent cancellation after loss of the commit response', async () => {
    const layout = await seed(); await setReceipt(layout, remoteReceipt('not-sent'))
    const timer = setTimeout, remove = IDBObjectStore.prototype.delete
    let expire!: () => void
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => { if (ms === 120_000) expire = fn; return timer(fn, ms) }) as typeof setTimeout)
    const fault = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.transaction.db.name === layout.projects.name && this.name === 'meta') this.transaction.addEventListener('complete', () => expire(), { once: true })
      return remove.call(this, key)
    })
    const worker = await actor(); await expect(worker.resume('cancel-not-sent')).rejects.toThrow('cancelled'); fault.mockRestore()
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put'), deletes = vi.spyOn(IDBObjectStore.prototype, 'delete')
    await expect(worker.resume('local-only')).rejects.toThrow()
    await worker.resume('cancel-not-sent'); expect(writes).not.toHaveBeenCalled(); expect(deletes).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  })
  it.each(['reserved', 'idb-committed', 'ls-committed', 'fenced', 'final'])('v5 interruption at %s keeps one target/proof and resumes in a fresh document', async phase => {
    const layout = await seed(); localStorage.setItem('arty-project-erasure-fence', 'interrupted')
    const put = IDBObjectStore.prototype.put, set = Storage.prototype.setItem
    const fault = phase === 'reserved' ? vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.transaction.db.name === layout.projects.name && key === 'erasure-fence') throw new Error('interruption')
      return put.call(this, value, key)
    }) : phase === 'idb-committed' ? vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'arty-project-erasure-fence') throw new DOMException('full', 'QuotaExceededError')
      return set.call(this, key, value)
    }) : phase === 'fenced' ? vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(() => { throw new Error('interruption') }) : crash(phase === 'ls-committed' ? 'fenced' : 'commit')
    await expect((await actor()).resume()).rejects.toThrow(); fault.mockRestore()
    const h = await control(); expect(h.version).toBe(5)
    const db = await openDB(layout.projects.name), local = localStorage.getItem('arty-project-erasure-fence'), active = await db.get('meta', 'erasure-fence')
    if (phase === 'reserved') { expect(local).toBe('interrupted'); expect(active).toBeUndefined() }
    else if (phase === 'idb-committed') { expect(local).toBe('interrupted'); expect(active).toBe(h.erasure.fence.target) }
    else { expect(local).toBe(h.erasure.fence.target); expect(active).toBe(h.erasure.fence.target) }
    if (phase !== 'final') expect(await db.get('projects', ['a', 'p'])).toBeDefined()
    db.close(); await newDocument()
    const checkpoints: unknown[] = []
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (value?.version === 5) checkpoints.push({ proof: value.erasure.proof, fence: value.erasure.fence })
      return put.call(this, value, key)
    })
    await (await actor()).resume(); expect((await control()).version).toBe(2)
    for (const checkpoint of checkpoints) expect(checkpoint).toEqual({ proof: h.erasure.proof, fence: h.erasure.fence })
  })
  it.each([undefined, null, false, 0, ''])('present malformed active fence %j is not absence or repairable', async value => {
    const layout = await seed(), db = await openDB(layout.projects.name); await db.put('meta', value, 'erasure-fence'); db.close()
    const initial = await control(), before = localPairs()
    await expect((await actor()).resume()).rejects.toThrow(); expect(await control()).toEqual(initial); expect(localPairs()).toEqual(before)
  })
  it.each(['B', 'legacy-fence', 'journal-fence', 'active-fence', 'nonce'])('v5 never rebaselines %s changed after reservation', async changed => {
    const layout = await seed(); localStorage.setItem('arty-project-erasure-fence', 'interrupted')
    const put = IDBObjectStore.prototype.put
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.transaction.db.name === layout.projects.name && key === 'erasure-fence') throw new Error('interruption')
      return put.call(this, value, key)
    })
    await expect((await actor()).resume()).rejects.toThrow(); fault.mockRestore(); const h = await control()
    const db = await openDB(changed === 'legacy-fence' ? 'arty-projects' : changed === 'journal-fence' ? migrationDatabaseName(layout.generation) : layout.projects.name)
    if (changed === 'B') await db.put('projects', { key: ['a-b', 'p'], owner: 'a-b', id: 'p', title: 'tampered' })
    else if (changed === 'nonce') await db.put('meta', { ...receipt(), nonce: crypto.randomUUID() }, ['erasing', 'a'])
    else await db.put('meta', 'foreign', 'erasure-fence')
    db.close(); await newDocument(); const writes = vi.spyOn(IDBObjectStore.prototype, 'put')
    await expect((await actor()).resume()).rejects.toThrow(); expect(writes).not.toHaveBeenCalled(); expect(await control()).toEqual(h)
  })
  it('v5 rejects a foreign LS fence inserted at verified instead of publishing ready', async () => {
    await seed(); localStorage.setItem('arty-project-erasure-fence', 'interrupted')
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (value?.version === 5 && value.erasure.phase === 'verified') localStorage.setItem('arty-project-erasure-fence', 'foreign')
      return put.call(this, value, key)
    })
    await expect((await actor()).resume()).rejects.toThrow(); expect((await control()).version).toBe(5); expect(localStorage.getItem('arty-project-erasure-fence')).toBe('foreign')
  })
  it.each(['before-idb-repair', 'before-ls-repair'])('v5 refuses foreign fence injected at %s after the previous asynchronous attestation', async point => {
    const layout = await seed(); localStorage.setItem('arty-project-erasure-fence', 'interrupted')
    const put = IDBObjectStore.prototype.put, digest = crypto.subtle.digest.bind(crypto.subtle)
    let reserved = false, activeCommitted = false, injected = false
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (value?.version === 5) this.transaction.addEventListener('complete', () => { reserved = true }, { once: true })
      if (this.transaction.db.name === layout.projects.name && key === 'erasure-fence') this.transaction.addEventListener('complete', () => { activeCommitted = true }, { once: true })
      return put.call(this, value, key)
    })
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      const result = await digest(algorithm, data)
      if (!injected && reserved && activeCommitted === (point === 'before-ls-repair') && new TextDecoder().decode(data).includes('arty-workspace-redacted')) {
        injected = true
        if (point === 'before-ls-repair') localStorage.setItem('arty-project-erasure-fence', 'foreign')
        else { const db = await openDB(layout.projects.name); await db.put('meta', 'foreign', 'erasure-fence'); db.close() }
      }
      return result
    })
    await expect((await actor()).resume()).rejects.toThrow(); expect(injected).toBe(true)
    const db = await openDB(layout.projects.name); expect(await db.get('projects', ['a', 'p'])).toBeDefined()
    if (point === 'before-idb-repair') expect(await db.get('meta', 'erasure-fence')).toBe('foreign')
    else expect(localStorage.getItem('arty-project-erasure-fence')).toBe('foreign')
    db.close(); expect((await control()).erasure.phase).toBe('reserved')
  })
  it.each(['local', 'active'])('not-sent cancellation refuses a %s fence changed after its preflight', async changed => {
    const layout = await seed(); await setReceipt(layout, remoteReceipt('not-sent'))
    const open = IDBDatabase.prototype.transaction
    let injected = false
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, stores, mode, options) {
      const tx = open.call(this, stores, mode, options)
      if (!injected && this.name === layout.projects.name && mode === 'readwrite') {
        injected = true
        if (changed === 'local') localStorage.setItem('arty-project-erasure-fence', 'foreign')
        else tx.objectStore('meta').put('foreign', 'erasure-fence')
      }
      return tx
    })
    await expect((await actor()).resume('cancel-not-sent')).rejects.toThrow(); expect(injected).toBe(true)
    const db = await openDB(layout.projects.name); expect(await db.get('meta', ['erasing', 'a'])).toEqual(remoteReceipt('not-sent')); db.close()
  })
})
