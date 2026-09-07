import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { isolatedControl } from '../helpers/isolatedWorkspace'
import { parseSyncApplyHeader, syncApplyJobKey, syncApplyCompletedBase } from '../../services/workspaceWriter/syncApplyProtocol'
import { readWorkspaceStorageLayout, WorkspaceSyncApplyAvailable } from '../../services/workspaceWriter/control'

const header = () => {
  const base = { ...isolatedControl(['a', 'b']), projectsVersion: 2 }
  return { ...base, version: 10, state: 'applying', revision: 2, base,
    apply: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', owner: 'a', phase: 'prepared', bytes: 1, hash: 'a'.repeat(64) } }
}
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
afterEach(() => vi.restoreAllMocks())
it('only advances the exact physical-2 ready base, preserving detached owner order', () => {
  const h = header(), parsed = parseSyncApplyHeader(h)!
  expect(parsed).toEqual(h); expect(syncApplyCompletedBase(parsed)).toEqual({ ...h.base, revision: 3 })
  parsed.requiredOwners.reverse(); expect(h.requiredOwners).toEqual(['a', 'b'])
})
it.each(['owner-anon', 'generation', 'requiredOwners', 'sparse', 'toJSON', 'accessor', 'extra', 'base-revision', 'unknown-phase', 'oversize', 'path', 'hash', 'old-physical', 'overflow'])('refuses malformed %s before any coercion', kind => {
  const h = header() as any, called = vi.fn(() => ['a', 'b'])
  if (kind === 'owner-anon') h.apply.owner = 'anon'
  if (kind === 'generation') h.generation = 'foreign'
  if (kind === 'requiredOwners') h.requiredOwners = ['b', 'a']
  if (kind === 'sparse') { h.base.requiredOwners = [null, 'b']; h.requiredOwners = [, 'b'] }
  if (kind === 'toJSON') h.requiredOwners.toJSON = called
  if (kind === 'accessor') Object.defineProperty(h.requiredOwners, '0', { get: called, enumerable: true })
  if (kind === 'extra') h.extra = true
  if (kind === 'base-revision') h.base.revision++
  if (kind === 'unknown-phase') h.apply.phase = 'receiving'
  if (kind === 'oversize') h.apply.bytes = 128 * 1024 * 1024 + 1
  if (kind === 'path') h.apply.id = '../other'
  if (kind === 'hash') h.apply.hash = 'x'
  if (kind === 'old-physical') delete h.base.projectsVersion
  if (kind === 'overflow') { h.base.revision = Number.MAX_SAFE_INTEGER - 1; h.revision = Number.MAX_SAFE_INTEGER }
  expect(parseSyncApplyHeader(h)).toBeNull(); expect(called).not.toHaveBeenCalled()
})
it.each(['exact', 'missing', 'extra', 'wrong-key'])('cold admission %s inventory never clones the large job', async kind => {
  const h = header(), db = await openDB('arty-workspace-control', 1, { upgrade(db) { db.createObjectStore('meta') } })
  await db.put('meta', h, 'workspace')
  if (kind !== 'missing') await db.put('meta', 'private ciphertext payload', kind === 'wrong-key' ? 'other' : syncApplyJobKey(h.apply.id))
  if (kind === 'extra') await db.put('meta', 'extra', 'extra')
  db.close()
  const get = vi.spyOn(IDBObjectStore.prototype, 'get'), all = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  const result = readWorkspaceStorageLayout({ assertLock() {}, signal: new AbortController().signal })
  if (kind === 'exact') await expect(result).rejects.toBeInstanceOf(WorkspaceSyncApplyAvailable)
  else await expect(result).rejects.toMatchObject({ code: 'corrupt' })
  expect(get.mock.calls.map(c => c[0])).toEqual(['workspace']); expect(all).not.toHaveBeenCalled()
})
