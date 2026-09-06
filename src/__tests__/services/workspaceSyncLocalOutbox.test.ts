import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB, deleteDB } from 'idb'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { seedIsolatedWorkspace, isolatedControl, GENERATION } from '../helpers/isolatedWorkspace'
import { deferred } from '../helpers/workspaceLocks'
import { isolatedWorkspaceLayout, workspaceDataKey } from '../../services/workspaceWriter/layout'
import type { SyncLocalBinding } from '../../services/workspaceSync/privateState'

vi.unmock('../../services/workspaceWriter/runtime')
vi.mock('../../services/workspaceWriter/activation', () => ({ ISOLATED_WORKSPACE_ENABLED: true, WORKSPACE_RESTORE_START_ENABLED: true, WORKSPACE_UPGRADE_START_ENABLED: false }))
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const bound = { vaultId: id(1), epoch: id(2) }
const code = 'ARTYSYNC1-00112233-44556677-8899AABB-CCDDEEFF-00112233-44556677-8899AABB-CCDDEEFF'
const layout = isolatedWorkspaceLayout(GENERATION, [], 2)
const account = (userId = 'a') => ({ userId, authMethod: 'apikey' as const, displayName: 'Synthetic', createdAt: 1 })
let runtime: typeof import('../../services/workspaceWriter/runtime'), lock: ReturnType<typeof deferred>
let service: typeof import('../../services/workspaceSync/localOutbox')
async function endDocument() {
  if (runtime?.documentWorkspace.getSnapshot() === 'held') { lock.resolve(); await vi.waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true)) }
}
async function newDocument() {
  await endDocument(); vi.resetModules(); lock = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request(_n: unknown, _o: unknown, cb: (v: unknown) => Promise<void>) { void cb({}); return lock.promise } } })
  runtime = await import('../../services/workspaceWriter/runtime')
  service = await import('../../services/workspaceSync/localOutbox')
  await runtime.documentWorkspace.acquire()
}
async function login(owner = 'a') {
  const users = await import('../../services/userSession')
  users.setActiveSession(account(owner)); await (await import('../../services/crypto')).initCrypto('test-key-' + owner)
}
async function rows() {
  const db = await openDB(layout.projects.name, 2)
  try { return [await db.getAllKeys('meta'), await db.getAll('meta')] as const } finally { db.close() }
}
async function alter(action: (db: Awaited<ReturnType<typeof openDB>>) => Promise<unknown>) {
  const db = await openDB(layout.projects.name, 2)
  try { await action(db) } finally { db.close() }
}
async function fixture(box: ReturnType<typeof service.createLocalSyncOutbox>, text = 'Historical A') {
  const payload = new Blob([text]), sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', await payload.arrayBuffer())).toString('hex')
  const { stageSyncChange } = await import('../../services/workspaceSync/causal')
  const next = stageSyncChange(box.snapshot.base, { ...bound, recordId: id(3), kind: 'conversation',
    revision: { id: id(4), intent: 'create', parents: [], value: { state: 'live', payloadId: id(5), bytes: payload.size, sha256 } } })
  const bindings: SyncLocalBinding[] = [{ kind: 'conversation', localId: 'chat-local', parentLocalId: null, logicalId: id(3), presence: 'record' },
    { kind: 'conversation', localId: 'unselected-original', parentLocalId: null, logicalId: id(6), presence: 'reference' }]
  return { next, bindings, payloads: new Map([[id(5), payload]]) }
}
async function prepared() {
  const box = service.createLocalSyncOutbox(); await box.unlock(code, bound)
  const f = await fixture(box), candidate = await box.prepareSnapshot(f.next, f.payloads, f.bindings)
  return { box, candidate, ...f }
}
beforeEach(async () => {
  vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); globalThis.indexedDB = new IDBFactory()
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden') }))
  await newDocument(); await seedIsolatedWorkspace()
  const projects = await openDB(layout.projects.name, 2); projects.close()
  const control = await openDB('arty-workspace-control', 1)
  await control.put('meta', { ...isolatedControl(), projectsVersion: 2 }, 'workspace'); control.close()
  expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await login()
})
afterEach(async () => { await endDocument(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('atomically persists an actual encrypted pair, reboots and resumes identical bytes without encrypt/random/capture', async () => {
  const { box, candidate, next, bindings } = await prepared(), initial = await rows()
  expect(initial[0]).toEqual([['sync-state', 'a']])
  await candidate.adopt(); const adopted = await rows(), before = (await box.resume())!
  const bytes = await before.ciphertext.arrayBuffer(), reference = before.reference
  expect(JSON.stringify(adopted)).not.toContain('chat-local')
  expect(JSON.stringify(adopted)).not.toContain('Historical A')
  expect(JSON.stringify(adopted)).not.toContain(code)
  expect(box.snapshot.base.records).toEqual([]) // not an ACK
  await newDocument(); expect(() => box.snapshot).toThrow()
  expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await login()
  const encrypt = vi.spyOn(webcrypto.subtle, 'encrypt'), random = vi.spyOn(webcrypto, 'getRandomValues'), uuid = vi.spyOn(webcrypto, 'randomUUID')
  const reopened = service.createLocalSyncOutbox(); await reopened.unlock(code)
  const resumed = (await reopened.resume())!
  expect(resumed.reference).toEqual(reference); expect(await resumed.ciphertext.arrayBuffer()).toEqual(bytes)
  expect(reopened.snapshot.bindings).toEqual(bindings); expect(await rows()).toEqual(adopted)
  expect(encrypt).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  const codec = await import('../../services/workspaceSync/encryption'), session = codec.createSyncVaultSession()
  const key = await session.unlock(code, bound, { signal: new AbortController().signal, assertCurrent() {}, async validateReadOnly() {} })
  expect((await codec.openSyncUpdate(key, reference, resumed.ciphertext, reopened.snapshot.base)).manifest).toEqual(next)
})

it('pending A and locked vault do not block a real encrypted chat save B; reload still retries A', async () => {
  const { box, candidate } = await prepared(); await candidate.adopt(); const a = await rows()
  box.lock()
  const history = await import('../../services/storage'); await history.bootstrapConversationStorage()
  const conversation = { id: 'chat-local', title: 'B', createdAt: 1, updatedAt: 2, messages: [{ id: 'message-B', role: 'user' as const, content: 'Changed B', timestamp: 2 }] }
  history.saveConversation(conversation)
  await vi.waitFor(() => expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'conversations-enc'))).toBeTruthy())
  expect(history.getConversation('chat-local')).toEqual(conversation); expect(await rows()).toEqual(a)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await login()
  const freshHistory = await import('../../services/storage'); await freshHistory.bootstrapConversationStorage()
  expect(freshHistory.getConversation('chat-local')).toEqual(conversation)
  const reopened = service.createLocalSyncOutbox(); await reopened.unlock(code); expect(await reopened.resume()).not.toBeNull()
  const f = await fixture(reopened, 'Changed B')
  await expect(reopened.prepareSnapshot(f.next, f.payloads, f.bindings)).rejects.toThrow('base'); expect(await rows()).toEqual(a)
})

it('wrong secret cannot reset or overwrite enrollment', async () => {
  const { box, candidate } = await prepared(); await candidate.adopt(); const before = await rows()
  await expect(box.unlock(code.replace('00112233', '00112234'), bound)).rejects.toThrow('integrity')
  expect(() => box.snapshot).toThrow('locked'); expect(await rows()).toEqual(before)
  await box.unlock(code); expect(await box.resume()).not.toBeNull()
})

it('quota on second write rolls back operation and state; retry uses the original sealed candidate', async () => {
  const { box, candidate } = await prepared(), before = await rows(), put = IDBObjectStore.prototype.put
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === layout.projects.name && value?.format === 'arty-sync-local-state') throw new DOMException('quota', 'QuotaExceededError')
    return put.call(this, value, key)
  })
  await expect(candidate.adopt()).rejects.toMatchObject({ name: 'QuotaExceededError' }); expect(await rows()).toEqual(before)
  failure.mockRestore(); const encryption = vi.spyOn(webcrypto.subtle, 'encrypt')
  await candidate.adopt(); const after = await rows(); await candidate.adopt()
  expect(await rows()).toEqual(after); expect(encryption).not.toHaveBeenCalled(); expect((await box.resume())!.reference).toEqual(candidate.reference)
})

it('concurrent candidates serialize by exact prior state and cannot replace pending A', async () => {
  const { box, candidate, next, bindings, payloads } = await prepared()
  const second = await box.prepareSnapshot(next, payloads, bindings)
  expect(second.reference.operationId).not.toBe(candidate.reference.operationId)
  await candidate.adopt(); const before = await rows()
  await expect(second.adopt()).rejects.toThrow('base'); expect(await rows()).toEqual(before)
})

it.each(['a-b', 'a:b'])('account ABA retires an old prepared handle, even after returning from %s', async neighbour => {
  const { candidate } = await prepared(), before = await rows()
  await login(neighbour); await login('a')
  await expect(candidate.adopt()).rejects.toThrow(); expect(await rows()).toEqual(before)
})

it.each([undefined, false, null])('presence of erasing receipt %s refuses an adoption without interpreting falsy as absent', async value => {
  const { candidate } = await prepared(); await alter(db => db.put('meta', value, ['erasing', 'a']))
  const before = await rows(); await expect(candidate.adopt()).rejects.toThrow(); expect(await rows()).toEqual(before)
})

it('deleted declared database is not recreated by the pending writer', async () => {
  const { candidate } = await prepared(); await deleteDB(layout.projects.name)
  await expect(candidate.adopt()).rejects.toThrow('missing')
  expect((await indexedDB.databases()).some(db => db.name === layout.projects.name)).toBe(false)
})

it('an IDB-only fence mismatch permanently closes RAM after its first detection', async () => {
  const { box, candidate } = await prepared(); await alter(db => db.put('meta', id(99), 'erasure-fence'))
  await expect(candidate.adopt()).rejects.toThrow(); expect(() => box.snapshot).toThrow()
})

it('an orphan blocks reopening, but individual account purge preserves both neighbours', async () => {
  const { box, candidate } = await prepared(); await candidate.adopt(); box.close()
  for (const owner of ['a-b', 'a:b']) {
    await login(owner); const other = service.createLocalSyncOutbox(); await other.unlock(code, bound)
    const f = await fixture(other); await (await other.prepareSnapshot(f.next, f.payloads, f.bindings)).adopt(); other.close()
  }
  await login(); await alter(db => db.delete('meta', ['sync-state', 'a']))
  const before = await rows(), fresh = service.createLocalSyncOutbox()
  await expect(fresh.unlock(code, bound)).rejects.toThrow('missing')
  const users = await import('../../services/userSession'), projects = await import('../../services/projects/store')
  users.removeKnownSession('a')
  await projects.purgeProjectsForAccount('a', () => {})
  const after = await rows()
  for (const owner of ['a-b', 'a:b']) {
    const select = (all: Awaited<ReturnType<typeof rows>>) => all[0].flatMap((key, i) => Array.isArray(key) && key[1] === owner ? [[key, all[1][i]]] : [])
    expect(select(after)).toEqual(select(before))
  }
  expect(after[0].some(key => Array.isArray(key) && key[1] === 'a')).toBe(false)
  await expect(fresh.unlock(code, bound)).rejects.toThrow()
})

it.each(['state-only', 'orphan'])('actual fresh crypto provisioning refuses %s while other owners remain exact', async kind => {
  const { box, candidate } = await prepared()
  if (kind === 'orphan') { await candidate.adopt(); await alter(db => db.delete('meta', ['sync-state', 'a'])) }
  box.close()
  for (const slot of ['crypto-salt', 'crypto-check', 'crypto-version'] as const) localStorage.removeItem(workspaceDataKey(layout, 'a', slot))
  const before = await rows(), crypt = await import('../../services/crypto')
  await expect(crypt.initCrypto('new-key')).rejects.toThrow()
  expect(localStorage.getItem(workspaceDataKey(layout, 'a', 'crypto-salt'))).toBeNull(); expect(await rows()).toEqual(before)
})

it('completed sync writes invalidate a restore proof and an exclusive restore publication rejects adoption', async () => {
  const { candidate } = await prepared(), activity = await import('../../services/workspaceWriter/localSyncActivity')
  const proof = activity.captureLocalSyncQuiescence(), release = proof.claimPublication(), before = await rows()
  await expect(candidate.adopt()).rejects.toThrow('publication_busy'); expect(await rows()).toEqual(before)
  release(); await candidate.adopt()
  expect(() => proof.assertCurrent()).toThrow('publication_busy')
})

it('a document retired after the actual IDB commit can recover only the complete exact pair in a new document', async () => {
  const { candidate } = await prepared(), put = IDBObjectStore.prototype.put
  const cut = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === layout.projects.name && value?.format === 'arty-sync-local-state') this.transaction.addEventListener('complete', () => runtime.documentWorkspace.retire(), { once: true })
    return put.call(this, value, key)
  })
  await expect(candidate.adopt()).rejects.toThrow(); cut.mockRestore(); const committed = await rows()
  expect(committed[0]).toHaveLength(2)
  await newDocument(); expect(await runtime.workspaceAdmission.admit()).toBe('ready'); await login()
  const box = service.createLocalSyncOutbox(); await box.unlock(code)
  expect((await box.resume())!.reference).toEqual(candidate.reference); expect(await rows()).toEqual(committed)
})

it('lock in the final asynchronous private-state validation cannot republish plaintext metadata', async () => {
  const { box } = await prepared(), codec = await import('../../services/workspaceSync/encryption')
  const original = codec.openSyncLocalState
  const spy = vi.spyOn(codec, 'openSyncLocalState').mockImplementation(async (...args) => {
    const opened = await original(...args)
    return { get plaintext() { return opened.plaintext }, async validate() { await opened.validate(); box.lock() } }
  })
  await expect(box.unlock(code)).rejects.toThrow('locked'); expect(() => box.snapshot).toThrow('locked')
  spy.mockRestore(); await box.unlock(code); expect(box.snapshot.base.records).toEqual([])
})

it('mixing two individually valid pairs does not decrypt a substituted private state', async () => {
  const { box, candidate } = await prepared(); const original = await rows()
  const { next, payloads, bindings } = await fixture(box, 'Other snapshot')
  const second = await box.prepareSnapshot(next, payloads, bindings)
  await candidate.adopt(); const firstRows = await rows()
  // Restore exact pre-adoption fixture only to obtain an independently sealed pair.
  await alter(async db => { await db.clear('meta'); await db.put('meta', original[1][0], original[0][0]) })
  await second.adopt(); const secondRows = await rows()
  const stateIndex = secondRows[0].findIndex(key => Array.isArray(key) && key[0] === 'sync-state')
  const firstState = firstRows[1][firstRows[0].findIndex(key => Array.isArray(key) && key[0] === 'sync-state')]
  const mixed = { ...secondRows[1][stateIndex], ciphertext: firstState.ciphertext }
  await alter(db => db.put('meta', mixed, ['sync-state', 'a']))
  const before = await rows(); await expect(box.unlock(code)).rejects.toThrow('integrity'); expect(await rows()).toEqual(before)
})
