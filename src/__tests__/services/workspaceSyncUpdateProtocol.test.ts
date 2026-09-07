import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { isolatedControl } from '../helpers/isolatedWorkspace'
import { parseSyncApplyHeader } from '../../services/workspaceWriter/syncApplyProtocol'
import { parseSyncUpdateHeader, syncUpdateJobKey, syncUpdateCompletedBase } from '../../services/workspaceWriter/syncUpdateProtocol'
import { readWorkspaceStorageLayout, WorkspaceSyncApplyAvailable } from '../../services/workspaceWriter/control'

const header = () => {
  const base = { ...isolatedControl(['a', 'b']), projectsVersion: 2 }
  return { ...base, version: 11, state: 'applying', revision: 2, base,
    apply: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', owner: 'a', phase: 'prepared', bytes: 1, hash: 'a'.repeat(64) } }
}
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
afterEach(() => vi.restoreAllMocks())
it('v11 stays distinct from additive v10 and completes the exact detached ready base', () => {
  const h = header(), parsed = parseSyncUpdateHeader(h)!
  expect(parsed).toEqual(h); expect(parseSyncApplyHeader(h)).toBeNull()
  expect(syncUpdateCompletedBase(parsed)).toEqual({ ...h.base, revision: 3 })
  parsed.requiredOwners.reverse(); expect(h.requiredOwners).toEqual(['a', 'b'])
  expect(parseSyncUpdateHeader({ ...h, version: 10 })).toBeNull()
})
it.each(['copies', 'aborting', 'unknown', 'extra', 'bad-owner', 'bad-physical', 'overflow', 'accessor'])('v11 refuses malformed %s without coercing it', kind => {
  const h = header() as any, called = vi.fn()
  if (['copies', 'aborting', 'unknown'].includes(kind)) h.apply.phase = kind
  if (kind === 'extra') h.apply.targets = []
  if (kind === 'bad-owner') h.apply.owner = 'anon'
  if (kind === 'bad-physical') delete h.base.projectsVersion
  if (kind === 'overflow') { h.base.revision = Number.MAX_SAFE_INTEGER - 1; h.revision = Number.MAX_SAFE_INTEGER }
  if (kind === 'accessor') Object.defineProperty(h, 'version', { enumerable: true, get: called })
  expect(parseSyncUpdateHeader(h)).toBeNull(); expect(called).not.toHaveBeenCalled()
})
it.each(['exact', 'missing', 'wrong-key', 'extra'])('v11 admission %s inventory never reads a large payload', async kind => {
  const h = header(), db = await openDB('arty-workspace-control', 1, { upgrade(db) { db.createObjectStore('meta') } })
  await db.put('meta', h, 'workspace')
  if (kind !== 'missing') await db.put('meta', 'private job', kind === 'wrong-key' ? `sync-apply:${h.apply.id}` : syncUpdateJobKey(h.apply.id))
  if (kind === 'extra') await db.put('meta', 'unexpected', 'extra')
  db.close()
  const get = vi.spyOn(IDBObjectStore.prototype, 'get'), all = vi.spyOn(IDBObjectStore.prototype, 'getAll')
  const result = readWorkspaceStorageLayout({ assertLock() {}, signal: new AbortController().signal })
  if (kind === 'exact') await expect(result).rejects.toBeInstanceOf(WorkspaceSyncApplyAvailable)
  else await expect(result).rejects.toMatchObject({ code: 'corrupt' })
  expect(get.mock.calls.map(c => c[0])).toEqual(['workspace']); expect(all).not.toHaveBeenCalled()
})
