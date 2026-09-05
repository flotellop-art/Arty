import type { IDBPDatabase } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { LEGACY_WORKSPACE_LAYOUT, type WorkspaceStorageLayout } from './layout'

export const WORKSPACE_CONTROL_DB = 'arty-workspace-control'
export const WORKSPACE_CONTROL_VERSION = 1
export const WORKSPACE_CONTROL_KEY = 'workspace'
export type AdmissionFailure = 'maintenance' | 'incompatible' | 'corrupt' | 'unavailable' | 'lost'
export class WorkspaceAdmissionError extends Error {
  constructor(public readonly code: AdmissionFailure) { super(`workspace_admission_${code}`); this.name = 'WorkspaceAdmissionError' }
}
export interface AdmissionGuard { assertLock(): void; signal: AbortSignal }

function reject(code: AdmissionFailure): never { throw new WorkspaceAdmissionError(code) }
function fields(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) return false
  const names = Object.getOwnPropertyNames(value)
  return names.length === keys.length && names.every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key)!
    return keys.includes(key) && d.enumerable && 'value' in d
  })
}
/** No generic ready/unknown-generation fallback. Metadata is not account data
 * or a restore journal, and this module exposes NO writer or repair operation. */
export function validateWorkspaceControl(value: unknown): void {
  if (!fields(value, ['format', 'version', 'layout', 'revision', 'state'])) reject('corrupt')
  if (value.format !== 'arty-workspace-control' || !Number.isSafeInteger(value.version) || (value.version as number) < 1) reject('corrupt')
  if (value.version !== 1) reject('incompatible')
  if (typeof value.layout !== 'string' || !value.layout.length || value.layout.length > 64 ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) reject('corrupt')
  if (value.layout !== 'legacy-v1') reject('incompatible')
  if (value.state === 'maintenance') reject('maintenance')
  if (value.state !== 'ready') reject('corrupt')
}

type IndexShape = readonly [name: string, path: string | readonly string[]]
type StoreShape = readonly [name: string, path: string | null, indexes: readonly IndexShape[]]
const CONTROL_SHAPE: readonly StoreShape[] = [['meta', null, []]]
const FILE_SHAPE: readonly StoreShape[] = [['files', 'fileId', [['ownerKey', 'ownerKey']]]]
const PROJECT_SHAPE: readonly StoreShape[] = [
  ['projects', 'key', [['owner', 'owner'], ['owner-state', ['owner', 'state']]]],
  ['documents', 'key', [['owner', 'owner'], ['owner-project', ['owner', 'projectId']], ['owner-state-kind', ['owner', 'state', 'kind']], ['owner-state-kind-bytes', ['owner', 'state', 'kind', 'sourceBytes']]]],
  ['usage', 'owner', []], ['meta', null, []],
]

/** Lock-only, bounded, readonly admission. Missing DB creation is rolled back;
 * blocked/unavailable/unknown storage never means a pristine installation.
 * The deadline covers queued opens AND readonly transactions, not just the
 * blocked event. A retired operation may close late but never grant access. */
export async function readWorkspaceStorageLayout(guard: AdmissionGuard, timeoutMs = 8_000): Promise<WorkspaceStorageLayout> {
  const retired = new AbortController()
  let timedOut = false
  const assertCurrent = () => {
    guard.assertLock()
    if (guard.signal.aborted) reject('lost')
    if (retired.signal.aborted) reject(timedOut ? 'unavailable' : 'lost')
  }
  assertCurrent()
  const cancel = () => retired.abort()
  guard.signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { timedOut = true; retired.abort() }, timeoutMs)
  let rejectStop!: (reason: Error) => void
  const stopped = new Promise<never>((_resolve, no) => { rejectStop = no })
  const stop = () => rejectStop(new WorkspaceAdmissionError(timedOut ? 'unavailable' : 'lost'))
  retired.signal.addEventListener('abort', stop, { once: true })
  const inspect = async (name: string, version: number, shape: readonly StoreShape[], control = false) => {
    assertCurrent()
    const db = await openExistingDB(name, version, assertCurrent, retired.signal)
    try {
      assertCurrent()
      if (!db) return
      if (db.version !== version || [...db.objectStoreNames].sort().join() !== shape.map(s => s[0]).sort().join()) reject('corrupt')
      await inspectDatabase(db, shape, control, assertCurrent, retired.signal)
      assertCurrent()
    } finally { db?.close() }
  }
  try {
    const reading = (async () => {
      await inspect(WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_VERSION, CONTROL_SHAPE, true)
      // A lost control DB must not silently admit known assets of a future
      // version. Future isolated stores need their own monotone witnesses too.
      const layout = LEGACY_WORKSPACE_LAYOUT
      await inspect(layout.files.name, layout.files.version, FILE_SHAPE)
      await inspect(layout.projects.name, layout.projects.version, PROJECT_SHAPE)
      assertCurrent()
      return layout
    })()
    return await Promise.race([reading, stopped])
  } catch (error) {
    if (guard.signal.aborted) reject('lost')
    if (error instanceof WorkspaceAdmissionError) throw error
    if (error && typeof error === 'object' && 'name' in error && error.name === 'VersionError') reject('incompatible')
    reject('unavailable')
  } finally {
    clearTimeout(timer)
    guard.signal.removeEventListener('abort', cancel)
    retired.signal.removeEventListener('abort', stop)
    retired.abort() // cancel/drain an unfinished operation after ANY failure
  }
}

async function inspectDatabase(db: IDBPDatabase, shape: readonly StoreShape[], control: boolean, assertCurrent: () => void, signal: AbortSignal) {
  const tx = db.transaction(shape.map(s => s[0]), 'readonly')
  const abort = () => { try { tx.abort() } catch { /* settled */ } }
  signal.addEventListener('abort', abort, { once: true })
  // Install rejection handling immediately, including a synchronous schema
  // failure or abort before the first awaited request.
  void tx.done.catch(() => {})
  try {
    assertCurrent()
    for (const [name, path, indexes] of shape) {
      const store = tx.objectStore(name)
      if (store.keyPath !== path || store.autoIncrement || [...store.indexNames].sort().join() !== indexes.map(i => i[0]).sort().join()) reject('corrupt')
      for (const [indexName, indexPath] of indexes) {
        const index = store.index(indexName)
        if (JSON.stringify(index.keyPath) !== JSON.stringify(indexPath) || index.unique || index.multiEntry) reject('corrupt')
      }
    }
    if (control) {
      const store = tx.objectStore('meta')
      if (await store.count() !== 1) reject('corrupt')
      assertCurrent()
      validateWorkspaceControl(await store.get(WORKSPACE_CONTROL_KEY))
    }
    await tx.done
    assertCurrent()
  } catch (error) {
    abort(); await tx.done.catch(() => {}); throw error
  } finally { signal.removeEventListener('abort', abort) }
}
