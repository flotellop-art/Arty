import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { isolatedControl } from '../helpers/isolatedWorkspace'
import { parseRestoreHeader, restoreJobKey, restoreCompletedBase } from '../../services/workspaceWriter/restoreProtocol'
import { readWorkspaceStorageLayout, WorkspaceRestoreAvailable } from '../../services/workspaceWriter/control'

const header = () => ({ ...isolatedControl(['a', 'b']), version: 8, state: 'restoring', revision: 2, base: isolatedControl(['a', 'b']),
  restore: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', owner: 'a', phase: 'copies', bytes: 1, hash: 'a'.repeat(64) } })
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
afterEach(() => vi.restoreAllMocks())
it('roundtrips the closed header and only advances ready revision', () => {
  const h = header(), parsed = parseRestoreHeader(h)!
  expect(parsed).toEqual(h); expect(restoreCompletedBase(parsed)).toEqual({ ...h.base, revision: 3 })
  expect(restoreJobKey(parsed.restore.id)).toBe('restore:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
})
it('new warm admission limits never strand a previously adopted larger cold journal', () => {
  const h = header(); h.restore.bytes = 128 * 1024 * 1024
  expect(parseRestoreHeader(h)).toEqual(h)
})
it.each(['owner-anon', 'generation', 'requiredOwners', 'sparse', 'toJSON', 'accessor', 'extra', 'base-revision', 'unknown-phase', 'oversize', 'path', 'hash'] as const)('refuses malformed %s without coercion or arbitrary address', kind => {
  const h = header() as any, called = vi.fn(() => ['a', 'b'])
  if (kind === 'owner-anon') h.restore.owner = 'anon'
  if (kind === 'generation') h.generation = 'foreign'
  if (kind === 'requiredOwners') h.requiredOwners = ['b', 'a']
  if (kind === 'sparse') { h.base.requiredOwners = [null, 'b']; h.requiredOwners = [, 'b'] }
  if (kind === 'toJSON') h.requiredOwners.toJSON = called
  if (kind === 'accessor') Object.defineProperty(h.requiredOwners, '0', { get: called, enumerable: true })
  if (kind === 'extra') h.extra = true
  if (kind === 'base-revision') h.base.revision++
  if (kind === 'unknown-phase') h.restore.phase = 'receiving'
  if (kind === 'oversize') h.restore.bytes = 128 * 1024 * 1024 + 1
  if (kind === 'path') h.restore.id = '../other'
  if (kind === 'hash') h.restore.hash = 'x'
  expect(parseRestoreHeader(h)).toBeNull(); expect(called).not.toHaveBeenCalled()
})
it.each(['exact', 'missing', 'extra', 'wrong-key'] as const)('cold admission %s job inventory never clones the large payload', async kind => {
  const h = header(), db = await openDB('arty-workspace-control', 1, { upgrade(db) { db.createObjectStore('meta') } })
  await db.put('meta', h, 'workspace')
  if (kind !== 'missing') await db.put('meta', 'private ciphertext payload', kind === 'wrong-key' ? 'other' : restoreJobKey(h.restore.id))
  if (kind === 'extra') await db.put('meta', 'extra', 'extra')
  db.close()
  const get = vi.spyOn(IDBObjectStore.prototype, 'get'), all = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  const result = readWorkspaceStorageLayout({ assertLock() {}, signal: new AbortController().signal })
  if (kind === 'exact') await expect(result).rejects.toBeInstanceOf(WorkspaceRestoreAvailable)
  else await expect(result).rejects.toMatchObject({ code: 'corrupt' })
  expect(get.mock.calls.map(c => c[0])).toEqual(['workspace']); expect(all).not.toHaveBeenCalled()
})
