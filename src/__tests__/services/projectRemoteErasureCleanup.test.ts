import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createRemoteErasure } from '../../services/accountErasureProtocol'
const mocks = vi.hoisted(() => ({ oauth: vi.fn(), wipe: vi.fn(), mail: vi.fn(), fetch: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mocks.oauth }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/secureFileStorage', () => ({ wipeFileStorage: mocks.wipe }))
vi.mock('../../services/mailAccounts', () => ({ purgeMailAccountsForUser: mocks.mail }))
let account: typeof import('../../services/accountService'), users: typeof import('../../services/userSession')
let store: typeof import('../../services/projects/store'), initial: object
const session = (userId = 'a') => ({ userId, authMethod: 'google' as const, email: `${userId}@example.test`, displayName: userId, createdAt: 1 })
let remote: Awaited<ReturnType<typeof createRemoteErasure>>, operationId: string
const response = (status: string) => Response.json({ protocol: 1, operationId, subjectHash: remote.subjectHash, status })
async function saved() { const db = await openDB('arty-projects', 1); try { return await db.get('meta', ['erasing', 'a']) } finally { db.close() } }
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  mocks.oauth.mockReset().mockImplementation(() => { throw new Error('OAuth forbidden') }); mocks.wipe.mockReset().mockResolvedValue(undefined); mocks.mail.mockReset().mockResolvedValue(undefined)
  users = await import('../../services/userSession'); users.setActiveSession(session())
  await (await import('../../services/crypto')).initCrypto('synthetic-a')
  store = await import('../../services/projects/store'); account = await import('../../services/accountService')
  remote = { ...await createRemoteErasure('google', 'a@example.test'), state: 'uncertain' }
  const lease = await store.beginProjectErasure('a', () => {}, false, remote); operationId = lease.operationId; initial = await saved()
  mocks.fetch.mockReset().mockResolvedValueOnce(response('cleanup-pending')).mockImplementation(async () => response('confirmed'))
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('legacy explicit command GETs first, never refreshes OAuth and cleans only after exact confirmation', async () => {
  expect(await account.continueAccountErasureCleanup()).toBe('complete')
  expect(mocks.fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
    ['/api/account/erasure-v1', 'GET'], ['/api/account/erasure-cleanup-v1', 'POST']])
  for (const [, init] of mocks.fetch.mock.calls) expect(Object.keys(init.headers).sort()).toEqual(['x-arty-erasure-capability', 'x-arty-erasure-operation'])
  expect(mocks.oauth).not.toHaveBeenCalled(); expect(mocks.wipe).toHaveBeenCalledWith('a'); expect(await saved()).toBeUndefined()
  expect((await indexedDB.databases()).some(db => db.name === 'arty-workspace-control')).toBe(false)
})
it('pending keeps the full journal; repeating the explicit command always consults first', async () => {
  mocks.fetch.mockReset().mockImplementation(async () => response('cleanup-pending'))
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow('erasure_cleanup_pending')
  expect(await saved()).toEqual(initial); expect(mocks.wipe).not.toHaveBeenCalled()
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow('erasure_cleanup_pending')
  expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET', 'POST'])
})
it('a lost cleanup response is recovered by GET confirmed without a second POST', async () => {
  mocks.fetch.mockReset().mockResolvedValueOnce(response('cleanup-pending')).mockRejectedValueOnce(new Error('lost response')).mockImplementation(async () => response('confirmed'))
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow('lost response')
  expect(await saved()).toEqual(initial); expect(mocks.wipe).not.toHaveBeenCalled()
  await account.continueAccountErasureCleanup()
  expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET'])
})
it.each(['not-sent', 'local-only', 'confirmed', 'legacy', 'nonempty-pending'])('refuses %s journal before network', async kind => {
  const row = await saved(), db = await openDB('arty-projects', 1)
  await db.put('meta', kind === 'confirmed' || kind === 'legacy' ? { owner: row.owner, operationId, nonce: row.nonce, serverConfirmed: kind === 'confirmed', pending: [] }
    : { ...row, ...(kind === 'local-only' ? { localOnly: true } : kind === 'nonempty-pending' ? { pending: [crypto.randomUUID()] } : { remote: { ...row.remote, state: 'not-sent' } }) }, ['erasing', 'a']); db.close()
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow(); expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.wipe).not.toHaveBeenCalled()
})
it.each(['GET', 'POST'])('refuses exact journal/context changes after %s before next destructive phase', async phase => {
  mocks.fetch.mockReset().mockImplementation(async (_url, init) => {
    if (init.method === phase) { const db = await openDB('arty-projects', 1), row = await saved(); await db.put('meta', { ...row, nonce: crypto.randomUUID() }, ['erasing', 'a']); db.close() }
    return response(init.method === 'GET' ? 'cleanup-pending' : 'confirmed')
  })
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow()
  expect(mocks.fetch).toHaveBeenCalledTimes(phase === 'GET' ? 1 : 2); expect(mocks.wipe).not.toHaveBeenCalled(); expect((await saved()).serverConfirmed).toBe(false)
})
it.each(['capability', 'kind', 'localOnly', 'pending', 'root', 'local-fence', 'active-fence', 'owner-epoch'])('rejects changed %s during GET instead of adopting a new erasure', async change => {
  mocks.fetch.mockReset().mockImplementation(async () => {
    const row = await saved(), db = await openDB('arty-projects', 1)
    if (change === 'root') {
      const root = await openDB('arty-workspace-control', 1, { upgrade(db) { db.createObjectStore('meta') } })
      await root.put('meta', { format: 'arty-workspace-control', version: 1, layout: 'legacy-v1', revision: 1, state: 'ready' }, 'workspace'); root.close()
    } else if (change === 'local-fence') localStorage.setItem('arty-project-erasure-fence', 'changed')
    else if (change === 'active-fence') await db.put('meta', 'changed', 'erasure-fence')
    else if (change === 'owner-epoch') { users.setActiveSession(session('b')); users.setActiveSession(session()) }
    else await db.put('meta', { ...row, ...(change === 'localOnly' ? { localOnly: true } : change === 'pending' ? { pending: [crypto.randomUUID()] } : { remote: { ...row.remote, ...(change === 'kind' ? { kind: 'email-trial' } : { capability: 'f'.repeat(64) }) } }) }, ['erasing', 'a'])
    db.close(); return response('cleanup-pending')
  })
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow(); expect(mocks.fetch).toHaveBeenCalledOnce(); expect(mocks.wipe).not.toHaveBeenCalled()
})
it('confirmation quota failure retains uncertainty; retry GET confirmed has no second cleanup POST', async () => {
  const put = IDBObjectStore.prototype.put
  const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.transaction.db.name === 'arty-projects' && value?.serverConfirmed) throw new DOMException('synthetic quota', 'QuotaExceededError')
    return put.call(this, value, key)
  })
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow('synthetic quota'); fault.mockRestore()
  expect(await saved()).toEqual(initial); expect(mocks.wipe).not.toHaveBeenCalled()
  await account.continueAccountErasureCleanup(); expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'GET'])
})
it.each(['nonce', 'active-fence', 'local-fence'])('warm confirmation refuses %s replaced inside the actual readwrite transaction', async change => {
  const open = IDBDatabase.prototype.transaction
  let injected = false
  const fault = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, stores, mode, options) {
    const tx = open.call(this, stores, mode, options)
    if (!injected && this.name === 'arty-projects' && mode === 'readwrite') {
      injected = true
      if (change === 'local-fence') localStorage.setItem('arty-project-erasure-fence', 'foreign')
      else if (change === 'active-fence') tx.objectStore('meta').put('foreign', 'erasure-fence')
      else tx.objectStore('meta').put({ ...initial, nonce: crypto.randomUUID() }, ['erasing', 'a'])
    }
    return tx
  })
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow(); fault.mockRestore()
  expect(injected).toBe(true); expect(await saved()).toEqual(initial); expect(mocks.wipe).not.toHaveBeenCalled()
  expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST'])
})
it('a failed local purge keeps confirmation and ordinary retry does not POST again', async () => {
  mocks.wipe.mockRejectedValueOnce(new Error('local disk'))
  await expect(account.continueAccountErasureCleanup()).rejects.toThrow('local disk')
  expect(await saved()).toMatchObject({ serverConfirmed: true }); expect(await saved()).not.toHaveProperty('remote')
  await account.deleteAccount(); expect(mocks.fetch).toHaveBeenCalledTimes(2)
})
