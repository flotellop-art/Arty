import type { IDBPDatabase } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { LEGACY_WORKSPACE_LAYOUT, isolatedWorkspaceLayout, type WorkspaceStorageLayout } from './layout'
import { ISOLATED_WORKSPACE_ENABLED } from './activation'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE, assertDatabaseShape, type StoreShape } from './schema'
import { parseMigrationHeader, type MigrationHeader } from './migrationProtocol'
import { parseErasureHeader } from './erasureProtocol'
import { parseAccountErasureRecord, erasureRecordState, type AccountErasureState } from '../accountErasureJournal'

export const WORKSPACE_CONTROL_DB = 'arty-workspace-control'
export const WORKSPACE_CONTROL_VERSION = 1
export const WORKSPACE_CONTROL_KEY = 'workspace'
export type AdmissionFailure = 'maintenance' | 'recoverable' | 'erasure' | 'incompatible' | 'corrupt' | 'unavailable' | 'lost'
export class WorkspaceAdmissionError extends Error {
  constructor(public readonly code: AdmissionFailure) { super(`workspace_admission_${code}`); this.name = 'WorkspaceAdmissionError' }
}
export class WorkspaceRecoveryAvailable extends WorkspaceAdmissionError {
  constructor(public readonly header: Readonly<MigrationHeader>) { super('recoverable') }
}
export class WorkspaceErasureRecoveryAvailable extends WorkspaceAdmissionError {
  constructor(public readonly mode: AccountErasureState = 'confirmed', public readonly binding?: string) { super('erasure') }
}
export const erasureAdmissionBinding = (generation: string, value: unknown) => JSON.stringify([generation, value])
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
export function validateWorkspaceControl(value: unknown): WorkspaceStorageLayout {
  const erasure = parseErasureHeader(value)
  if (erasure) throw new WorkspaceErasureRecoveryAvailable(erasure.version === 5 ? erasureRecordState(erasure.erasure.authority) : 'confirmed', erasureAdmissionBinding(erasure.generation, erasure))
  const migration = parseMigrationHeader(value)
  if (migration) throw new WorkspaceRecoveryAvailable(migration)
  const legacyFields = ['format', 'version', 'layout', 'revision', 'state']
  if (!fields(value, legacyFields) && !fields(value, [...legacyFields, 'generation', 'requiredOwners'])) reject('corrupt')
  if (value.format !== 'arty-workspace-control' || !Number.isSafeInteger(value.version) || (value.version as number) < 1) reject('corrupt')
  if (value.version !== 1 && value.version !== 2) reject('incompatible')
  if (typeof value.layout !== 'string' || !value.layout.length || value.layout.length > 64 ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) reject('corrupt')
  let layout: WorkspaceStorageLayout
  if (value.version === 1 && value.layout === 'legacy-v1') {
    if (!fields(value, legacyFields)) reject('corrupt')
    layout = LEGACY_WORKSPACE_LAYOUT
  } else if (value.version === 2 && value.layout === 'isolated-v1') {
    if (!fields(value, [...legacyFields, 'generation', 'requiredOwners'])) reject('corrupt')
    try { layout = isolatedWorkspaceLayout(value.generation as string, value.requiredOwners as (string | null)[]) }
    catch { reject('corrupt') }
    if (!ISOLATED_WORKSPACE_ENABLED) reject('incompatible')
  } else reject('incompatible')
  if (value.state === 'maintenance') reject('maintenance')
  if (value.state !== 'ready') reject('corrupt')
  return layout
}

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
  const inspect = async (name: string, version: number, shape: readonly StoreShape[], control = false, required = false, cleanup?: string) => {
    assertCurrent()
    const db = await openExistingDB(name, version, assertCurrent, retired.signal)
    try {
      assertCurrent()
      if (!db) { if (required) reject('corrupt'); return }
      if (db.version !== version || [...db.objectStoreNames].sort().join() !== shape.map(s => s[0]).sort().join()) reject('corrupt')
      const layout = await inspectDatabase(db, shape, control, assertCurrent, retired.signal, cleanup)
      assertCurrent()
      return layout
    } finally { db?.close() }
  }
  try {
    const reading = (async () => {
      const layout = await inspect(WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_VERSION, CONTROL_SHAPE, true) ?? LEGACY_WORKSPACE_LAYOUT
      // A lost control DB must not silently admit known assets of a future
      // version. Future isolated stores need their own monotone witnesses too.
      if (layout.kind === 'isolated-v1') {
        // Real version barriers in the old stores; a descriptor alone cannot
        // exclude an old APK/worker which only understands the legacy layout.
        await inspect(LEGACY_WORKSPACE_LAYOUT.files.name, 2, FILE_SHAPE, false, true)
        await inspect(LEGACY_WORKSPACE_LAYOUT.projects.name, 2, PROJECT_SHAPE, false, true)
      }
      await inspect(layout.files.name, layout.files.version, FILE_SHAPE, false, layout.kind === 'isolated-v1')
      await inspect(layout.projects.name, layout.projects.version, PROJECT_SHAPE, false, layout.kind === 'isolated-v1', layout.kind === 'isolated-v1' ? layout.generation : undefined)
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

async function inspectDatabase(db: IDBPDatabase, shape: readonly StoreShape[], control: boolean, assertCurrent: () => void, signal: AbortSignal, cleanup?: string) {
  let layout: WorkspaceStorageLayout | undefined
  const tx = db.transaction(shape.map(s => s[0]), 'readonly')
  const abort = () => { try { tx.abort() } catch { /* settled */ } }
  signal.addEventListener('abort', abort, { once: true })
  // Install rejection handling immediately, including a synchronous schema
  // failure or abort before the first awaited request.
  void tx.done.catch(() => {})
  try {
    assertCurrent()
    try { assertDatabaseShape(db, shape, tx) } catch { reject('corrupt') }
    if (control) {
      const store = tx.objectStore('meta')
      if (await store.count() !== 1) reject('corrupt')
      assertCurrent()
      layout = validateWorkspaceControl(await store.get(WORKSPACE_CONTROL_KEY))
    }
    if (cleanup) {
      let cursor = await tx.objectStore('meta').openCursor(), mode: AccountErasureState | undefined, binding: string | undefined, found = 0
      while (cursor) {
        assertCurrent()
        if (Array.isArray(cursor.key) && cursor.key[0] === 'erasing') {
          found++
          const parsed = parseAccountErasureRecord(cursor.value)
          if (!parsed || cursor.key.length !== 2 || cursor.key[1] !== parsed.owner) reject('maintenance')
          mode = erasureRecordState(parsed)
          binding = erasureAdmissionBinding(cleanup, parsed)
        }
        cursor = await cursor.continue()
      }
      if (found > 1) reject('maintenance')
      if (mode) throw new WorkspaceErasureRecoveryAvailable(mode, binding)
    }
    await tx.done
    assertCurrent()
    return layout
  } catch (error) {
    abort(); await tx.done.catch(() => {}); throw error
  } finally { signal.removeEventListener('abort', abort) }
}
