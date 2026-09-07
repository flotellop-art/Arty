import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { workspaceAdmission } from './runtime'
import { ISOLATED_WORKSPACE_ENABLED, WORKSPACE_UPGRADE_START_ENABLED } from './activation'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY, type AdmissionGuard } from './control'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE, assertDatabaseShape, type StoreShape } from './schema'
import { controlProjectsVersion, isolatedWorkspaceLayout } from './layout'
import { parseRestoreReady } from './restoreProtocol'
import { validErasureFence } from './erasureProtocol'
import { parseWorkspaceUpgrade, completedWorkspaceUpgrade, type WorkspaceUpgradeHeader } from './upgradeProtocol'
import { rawEncoding } from './migrationInventory'
import { isNative } from '../native/platform'

const FENCE_KEY = 'arty-project-erasure-fence'
type Guard = AdmissionGuard & { assertCurrent(): void }
const equal = (a: unknown, b: unknown) => rawEncoding(a) === rawEncoding(b)
const refuse = (): never => { throw new Error('workspace_upgrade_unverifiable') }

/** Claims the actual cold document. No warm App, caller-supplied DB name,
 * storage flag, account key, fetch or auth dependency can authorize an upgrade.
 * Completion retains maintenance until destruction of this document. */
export function createColdWorkspaceUpgrade(action: 'start' | 'resume') {
  if (action !== 'start' && action !== 'resume') refuse()
  if (!ISOLATED_WORKSPACE_ENABLED || (action === 'start' && (!WORKSPACE_UPGRADE_START_ENABLED || isNative))) throw new Error('workspace_upgrade_disabled')
  const observed = workspaceAdmission.getUpgradeRecovery()
  const cold = workspaceAdmission.claimMaintenance()
  let busy = false, knownTicket = observed, knownFinal: unknown, knownBase: unknown
  return Object.freeze({ async run(timeoutMs = 8_000) {
    cold.assertLock()
    if (busy) throw new Error('workspace_upgrade_busy')
    busy = true
    const lifetime = new AbortController(), cancel = () => lifetime.abort()
    const guard: Guard = { ...cold, signal: lifetime.signal, assertCurrent() {
      cold.assertLock()
      if (cold.signal.aborted || lifetime.signal.aborted) throw new Error('workspace_upgrade_cancelled')
      if (knownTicket) assertLocalFence(knownTicket)
    } }
    cold.signal.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, timeoutMs)
    let rejectStop!: (error: Error) => void
    const stopped = new Promise<never>((_yes, no) => { rejectStop = no })
    const stop = () => rejectStop(new Error('workspace_upgrade_cancelled'))
    lifetime.signal.addEventListener('abort', stop, { once: true })
    const work = async () => {
      const root = await readControl(guard)
      if (knownFinal && equal(root, knownFinal)) {
        // Only the exact final staged by THIS actor, never an arbitrary ready.
        const header = knownTicket!
        await inspectWorkspace(header, 2, guard)
        if (!equal(await readControl(guard), knownFinal)) refuse()
        return
      }
      let header = parseWorkspaceUpgrade(root)
      if (header) {
        if (knownTicket ? !equal(header, knownTicket) : action !== 'resume') refuse()
        knownTicket = header
      } else {
        if (action !== 'start' || !WORKSPACE_UPGRADE_START_ENABLED || knownTicket) refuse()
        const base = parseRestoreReady(root)
        if (!base || controlProjectsVersion(base) !== 1 || base.revision > Number.MAX_SAFE_INTEGER - 2 ||
          (knownBase !== undefined && !equal(base, knownBase))) return refuse()
        knownBase = base
        const layout = isolatedWorkspaceLayout(base.generation, base.requiredOwners)
        await inspectCompanions(layout.files.name, guard)
        const db = await inspect(layout.projects.name, 1, PROJECT_SHAPE, guard)
        let fences: [string | null, string | null]
        try { fences = await readFences(db, guard) } finally { db.close() }
        guard.assertCurrent()
        header = parseWorkspaceUpgrade({ format: 'arty-workspace-control', version: 9, layout: 'isolated-v1', state: 'upgrading',
          revision: base.revision + 1, generation: base.generation, requiredOwners: [...base.requiredOwners], base,
          upgrade: { id: crypto.randomUUID(), from: 1, to: 2, localFence: fences[0], activeFence: fences[1] } })
        if (!header) return refuse()
        // Capture identity before CAS, including the uncertain-commit case.
        knownTicket = header
        await cas(base, header, guard, () => assertLocalFence(header!))
      }
      const version = await inspectWorkspace(header, undefined, guard)
      if (!equal(await readControl(guard), header)) refuse()
      if (version === 1) await raiseProjectsVersion(header, guard)
      await inspectWorkspace(header, 2, guard)
      if (!equal(await readControl(guard), header)) refuse()
      const final = completedWorkspaceUpgrade(header)
      knownFinal = final
      await cas(header, final, guard, () => assertLocalFence(header!))
    }
    try { await Promise.race([work(), stopped]) }
    finally {
      lifetime.abort(); clearTimeout(timer); cold.signal.removeEventListener('abort', cancel)
      lifetime.signal.removeEventListener('abort', stop); busy = false
    }
  } })
}

async function transaction<T, M extends 'readonly' | 'readwrite'>(db: IDBPDatabase, stores: string[], mode: M, guard: Guard,
  work: (tx: IDBPTransaction<unknown, string[], M>) => Promise<T>): Promise<T> {
  guard.assertCurrent()
  const tx = db.transaction(stores, mode), abort = () => { try { tx.abort() } catch { /* settled */ } }
  guard.signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
  try { guard.assertCurrent(); const result = await work(tx); guard.assertCurrent(); await tx.done; guard.assertCurrent(); return result }
  catch (error) { abort(); await tx.done.catch(() => {}); throw error }
  finally { guard.signal.removeEventListener('abort', abort) }
}
async function inspect(name: string, version: number | undefined, shape: readonly StoreShape[], guard: Guard) {
  const db = await openExistingDB(name, version, guard.assertCurrent, guard.signal)
  if (!db) return refuse()
  try {
    if (version !== undefined && db.version !== version) refuse()
    await transaction(db, shape.map(s => s[0]), 'readonly', guard, async tx => { assertDatabaseShape(db, shape, tx) })
    return db
  } catch (error) { db.close(); throw error }
}
async function readControl(guard: Guard) {
  const db = await inspect(WORKSPACE_CONTROL_DB, 1, CONTROL_SHAPE, guard)
  try { return await transaction(db, ['meta'], 'readonly', guard, async tx => {
    if (await tx.objectStore('meta').count() !== 1) return refuse()
    return tx.objectStore('meta').get(WORKSPACE_CONTROL_KEY)
  }) } finally { db.close() }
}
async function cas(expected: unknown, next: unknown, guard: Guard, finalCheck: () => void) {
  const db = await inspect(WORKSPACE_CONTROL_DB, 1, CONTROL_SHAPE, guard)
  try { await transaction(db, ['meta'], 'readwrite', guard, async tx => {
    const store = tx.objectStore('meta')
    if (await store.count() !== 1 || !equal(await store.get(WORKSPACE_CONTROL_KEY), expected)) refuse()
    guard.assertCurrent(); finalCheck(); await store.put(next, WORKSPACE_CONTROL_KEY)
  }) } finally { db.close() }
}
function localFence(): string | null {
  const value = localStorage.getItem(FENCE_KEY)
  if (value !== null && !validErasureFence(value)) return refuse()
  return value
}
function assertLocalFence(header: WorkspaceUpgradeHeader) { if (localFence() !== header.upgrade.localFence) refuse() }
async function metaFence(tx: IDBPTransaction<unknown, string[], 'readonly' | 'versionchange'>, guard: Guard): Promise<string | null> {
  const store = tx.objectStore('meta'), count = await store.count()
  if (count > 1) return refuse()
  const key = await store.openKeyCursor()
  if (!key) return null
  if (key.key !== 'erasure-fence') return refuse()
  const value = await store.get(key.key)
  guard.assertCurrent()
  if (!validErasureFence(value)) return refuse()
  return value
}
async function readFences(db: IDBPDatabase, guard: Guard): Promise<[string | null, string | null]> {
  const local = localFence()
  const active = await transaction(db, ['meta'], 'readonly', guard, tx => metaFence(tx, guard))
  if (local !== localFence() || (local ?? 'initial') !== (active ?? 'initial')) return refuse()
  return [local, active]
}
async function inspectCompanions(files: string, guard: Guard) {
  for (const [name, version, shape] of [['arty-files', 2, FILE_SHAPE], ['arty-projects', 2, PROJECT_SHAPE], [files, 1, FILE_SHAPE]] as const) {
    const db = await inspect(name, version, shape, guard); db.close()
  }
}
async function inspectWorkspace(header: WorkspaceUpgradeHeader, expected: number | undefined, guard: Guard) {
  const layout = isolatedWorkspaceLayout(header.generation, header.requiredOwners)
  await inspectCompanions(layout.files.name, guard)
  const db = await inspect(layout.projects.name, expected, PROJECT_SHAPE, guard)
  try {
    if (db.version !== 1 && db.version !== 2) return refuse()
    const fences = await readFences(db, guard)
    if (!equal(fences, [header.upgrade.localFence, header.upgrade.activeFence])) return refuse()
    return db.version
  } finally { db.close() }
}
async function raiseProjectsVersion(header: WorkspaceUpgradeHeader, guard: Guard) {
  guard.assertCurrent(); assertLocalFence(header)
  const name = isolatedWorkspaceLayout(header.generation, header.requiredOwners).projects.name
  let retired = false, upgraded = false
  let rejectStop!: (error: Error) => void
  const stopped = new Promise<never>((_yes, no) => { rejectStop = no })
  const stop = () => { retired = true; rejectStop(new Error('workspace_upgrade_cancelled')) }
  guard.signal.addEventListener('abort', stop, { once: true })
  try {
    const opening = openDB(name, 2, {
      upgrade(db, oldVersion, newVersion, tx) {
        void tx.done.catch(() => {})
        const abort = () => { try { tx.abort() } catch { /* settled */ } }
        guard.signal.addEventListener('abort', abort, { once: true })
        void tx.done.then(() => guard.signal.removeEventListener('abort', abort), () => guard.signal.removeEventListener('abort', abort))
        void (async () => {
          guard.assertCurrent()
          if (retired || oldVersion !== 1 || newVersion !== 2) refuse() // oldVersion 0 MUST NOT create
          assertDatabaseShape(db, PROJECT_SHAPE, tx)
          if (await metaFence(tx, guard) !== header.upgrade.activeFence) refuse()
          guard.assertCurrent(); assertLocalFence(header)
          if (retired) refuse()
          upgraded = true // No store/row/LS mutation; only the physical barrier.
        })().catch(abort)
      },
      blocked: stop,
      blocking() { void opening.then(db => db.close(), () => {}) },
    })
    const checked = opening.then(db => {
      try { guard.assertCurrent(); if (retired || !upgraded || db.version !== 2) refuse() }
      finally { db.close() }
    })
    await Promise.race([checked, stopped])
  } finally { retired = true; guard.signal.removeEventListener('abort', stop) }
}
