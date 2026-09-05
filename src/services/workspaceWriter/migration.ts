import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { ISOLATED_WORKSPACE_ENABLED } from './activation'
import { workspaceAdmission } from './runtime'
import { validateWorkspaceControl, readWorkspaceStorageLayout, WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY, type AdmissionGuard } from './control'
import { isolatedWorkspaceLayout } from './layout'
import { assertDatabaseShape, createDatabaseShape, CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE, type StoreShape } from './schema'
import { parseMigrationHeader, migrationDatabaseName, type MigrationHeader, type MigrationPhase } from './migrationProtocol'
import { digestRaw, localPairs, localTargets, parseLegacySlot, validateSessions, observeLocalOwnerHints, observeRawOwner, scanRawStore,
  RAW_STORES, rawEncoding, failMigration, WorkspaceMigrationError, type MigrationPlan, type RawRow, type RawStore } from './migrationInventory'

const JOURNAL_SHAPE: readonly StoreShape[] = [['journal', null, []], ...RAW_STORES.map(name => [name, null, []] as const)]
const identity = (generation: string) => ({ format: 'arty-workspace-migration', version: 1, generation })
const equal = (a: unknown, b: unknown) => rawEncoding(a) === rawEncoding(b)
type Attempt = AdmissionGuard & { assertCurrent(): void }

/** Candidate only. Intrinsic release policy AND the actual document singleton
 * protect every entry point. No caller-supplied boolean/noop guard can opt in.
 * A failed attempt is retired; the same cold document can explicitly retry.
 * No private session, crypto, HTTP, native credentials, or App imports here. */
export function createColdWorkspaceMigration() {
  if (!ISOLATED_WORKSPACE_ENABLED) return failMigration('disabled')
  const cold = workspaceAdmission.claimMaintenance()
  let busy = false
  let knownGeneration = workspaceAdmission.getRecovery()?.generation
  const run = async (start: boolean) => {
    if (!ISOLATED_WORKSPACE_ENABLED) return failMigration('disabled')
    cold.assertLock()
    if (busy) return failMigration('busy')
    busy = true
    const aborter = new AbortController(), cancel = () => aborter.abort()
    cold.signal.addEventListener('abort', cancel, { once: true })
    // Deadline without progress, not a cap on the whole account. Every guarded
    // cursor/request checkpoint rearms it; queued/stalled work still retires.
    let timeout = setTimeout(cancel, 120_000)
    const guard: Attempt = { signal: aborter.signal, assertLock: cold.assertLock, assertCurrent() {
      if (!ISOLATED_WORKSPACE_ENABLED) failMigration('disabled')
      cold.assertLock()
      if (cold.signal.aborted || aborter.signal.aborted) failMigration('cancelled')
      clearTimeout(timeout); timeout = setTimeout(cancel, 120_000)
    } }
    let rejectStop!: (reason: Error) => void
    const stopped = new Promise<never>((_yes, no) => { rejectStop = no })
    const stop = () => rejectStop(new WorkspaceMigrationError('cancelled'))
    aborter.signal.addEventListener('abort', stop, { once: true })
    try { return await Promise.race([migrate(start, guard, knownGeneration, generation => { knownGeneration = generation }), stopped]) }
    finally {
      cancel(); clearTimeout(timeout); cold.signal.removeEventListener('abort', cancel)
      aborter.signal.removeEventListener('abort', stop); busy = false
    }
  }
  return Object.freeze({ start: () => run(true), resume: () => run(false) })
}

async function transaction<T, M extends 'readonly' | 'readwrite'>(db: IDBPDatabase, stores: string[], mode: M, guard: Attempt,
  work: (tx: IDBPTransaction<unknown, string[], M>) => Promise<T>): Promise<T> {
  guard.assertCurrent()
  const tx = db.transaction(stores, mode)
  const abort = () => { try { tx.abort() } catch { /* settled */ } }
  guard.signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
  try {
    const result = await work(tx); guard.assertCurrent(); await tx.done; guard.assertCurrent(); return result
  } catch (error) { abort(); await tx.done.catch(() => {}); throw error }
  finally { guard.signal.removeEventListener('abort', abort) }
}
async function inspect(name: string, shape: readonly StoreShape[], guard: Attempt): Promise<IDBPDatabase | null> {
  const db = await openExistingDB(name, undefined, guard.assertCurrent, guard.signal)
  if (!db) return null
  try {
    await transaction(db, shape.map(s => s[0]), 'readonly', guard, async tx => { assertDatabaseShape(db, shape, tx) })
    return db
  } catch (error) { db.close(); throw error }
}
/** Retired/blocked opens may wake later, but cannot create a store or commit an
 * upgrade. Existing connections close on versionchange; no forced takeover. */
async function writable(name: string, version: number, shape: readonly StoreShape[], guard: Attempt,
  initialize?: (db: IDBPDatabase, tx: IDBPTransaction<unknown, string[], 'versionchange'>) => void): Promise<IDBPDatabase> {
  guard.assertCurrent()
  let retired = false, rejectStop!: (reason: Error) => void
  const stopped = new Promise<never>((_yes, no) => { rejectStop = no })
  const stop = () => { retired = true; rejectStop(new WorkspaceMigrationError('cancelled')) }
  guard.signal.addEventListener('abort', stop, { once: true })
  try {
  const opening = openDB(name, version, {
    upgrade(db, oldVersion, _next, tx) {
      void tx.done.catch(() => {})
      try {
        guard.assertCurrent(); if (retired) failMigration('cancelled')
        if (oldVersion === 0) { createDatabaseShape(db, shape); initialize?.(db, tx) }
        else assertDatabaseShape(db, shape, tx)
        guard.assertCurrent()
      } catch { tx.abort() }
    },
    blocked() { retired = true; rejectStop(new WorkspaceMigrationError('storage')) },
    blocking() { void opening.then(db => db.close(), () => {}) },
  })
  const result = opening.then(async db => {
    try {
      guard.assertCurrent(); if (retired) failMigration('cancelled')
      await transaction(db, shape.map(s => s[0]), 'readonly', guard, async tx => { assertDatabaseShape(db, shape, tx) })
      return db
    } catch (error) { db.close(); throw error }
  })
  return await Promise.race([result, stopped])
  }
  finally { guard.signal.removeEventListener('abort', stop) }
}
async function readControl(guard: Attempt): Promise<unknown | null> {
  const db = await inspect(WORKSPACE_CONTROL_DB, CONTROL_SHAPE, guard)
  if (!db) return null
  try {
    if (db.version !== 1) failMigration('unsupported')
    return await transaction(db, ['meta'], 'readonly', guard, async tx => {
      if (await tx.objectStore('meta').count() !== 1) failMigration('unsupported')
      return tx.objectStore('meta').get(WORKSPACE_CONTROL_KEY)
    })
  } finally { db.close() }
}
async function compareAndSwap(expected: unknown, next: unknown, guard: Attempt, create = false, beforePut?: () => void) {
  const db = create ? await writable(WORKSPACE_CONTROL_DB, 1, CONTROL_SHAPE, guard, (_db, tx) => {
    void tx.objectStore('meta').put(next, WORKSPACE_CONTROL_KEY).catch(() => {})
  }) : await inspect(WORKSPACE_CONTROL_DB, CONTROL_SHAPE, guard)
  if (!db) return failMigration('missing')
  try {
    if (db.version !== 1) failMigration('unsupported')
    await transaction(db, ['meta'], 'readwrite', guard, async tx => {
      const store = tx.objectStore('meta'), current = await store.get(WORKSPACE_CONTROL_KEY)
      if (await store.count() !== 1 || (!equal(current, expected) && !(create && expected === null && equal(current, next)))) failMigration('changed')
      guard.assertCurrent(); beforePut?.(); await store.put(next, WORKSPACE_CONTROL_KEY)
    })
  } finally { db.close() }
}
async function advance(header: Readonly<MigrationHeader>, phase: MigrationPhase, guard: Attempt): Promise<Readonly<MigrationHeader>> {
  const next = { ...header, revision: header.revision + 1, phase }
  await compareAndSwap(header, next, guard)
  return next
}
async function assertControl(header: Readonly<MigrationHeader>, guard: Attempt) {
  if (!equal(await readControl(guard), header)) failMigration('changed')
}

async function readInventory(guard: Attempt, permitted: [string, string][] = []): Promise<MigrationPlan> {
  guard.assertCurrent()
  const pairs = localPairs(), targets = new Map(permitted), source = pairs.filter(([key, value]) => {
    if (!targets.has(key)) return true
    if (targets.get(key) !== value) failMigration('changed')
    return false // only this job's exact, originally-absent target pairs
  })
  const owners = new Set<string | null>(validateSessions(source))
  observeLocalOwnerHints(source, owners)
  // Unattributed generations must be reconciled, never silently excluded.
  if (source.some(([key]) => key.startsWith('arty-workspace:'))) failMigration('collision')
  const localSource = source.filter(([key]) => {
    const part = parseLegacySlot(key); if (part) owners.add(part.owner); return !!part
  })
  const localHash = await digestRaw(source), fence = new Map(source).get('arty-project-erasure-fence') ?? 'initial'
  if (!fence) failMigration('erasure')
  const files = await inspect('arty-files', FILE_SHAPE, guard)
  let projects: IDBPDatabase | null = null
  try {
    projects = await inspect('arty-projects', PROJECT_SHAPE, guard)
    const versions: [number, number] = [files?.version ?? 0, projects?.version ?? 0]
    if (versions.some(v => v > 2)) failMigration('unsupported')
    const stores = []
    let sawFence = false
    for (const store of RAW_STORES) {
      stores.push(await scanRawStore(store === 'files' ? files : projects, store, guard.assertCurrent, guard.signal, async rows => {
        for (const row of rows) { observeRawOwner(store, row, owners, fence); if (store === 'meta' && row.key === 'erasure-fence') sawFence = true }
      }))
    }
    if (!sawFence && fence !== 'initial') failMigration('erasure')
    const plan: MigrationPlan = { version: 1, owners: [...owners].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0), localSource, localHash, versions, stores }
    // Recheck local bytes after every asynchronous inventory pass.
    if (!equal(pairs, localPairs())) failMigration('changed')
    return plan
  } finally { files?.close(); projects?.close() }
}
function sameInventory(expected: MigrationPlan, actual: MigrationPlan) {
  if (!equal({ ...expected, versions: [] }, { ...actual, versions: [] })) failMigration('changed')
}
async function openJournal(header: Readonly<MigrationHeader>, guard: Attempt) {
  const name = migrationDatabaseName(header.generation)
  let db = await inspect(name, JOURNAL_SHAPE, guard)
  if (!db) {
    if (header.phase !== 'reserved') return failMigration('missing')
    db = await writable(name, 1, JOURNAL_SHAPE, guard, (_db, tx) => { void tx.objectStore('journal').put(identity(header.generation), 'identity').catch(() => {}) })
  }
  try {
    if (db.version !== 1) failMigration('unsupported')
    await transaction(db, ['journal'], 'readonly', guard, async tx => {
      const s = tx.objectStore('journal'), keys = await s.getAllKeys()
      if (!equal(await s.get('identity'), identity(header.generation)) || keys.some(k => k !== 'identity' && k !== 'plan')) failMigration('collision')
    })
    return db
  } catch (error) { db.close(); throw error }
}
function validatePlan(value: unknown, generation: string): MigrationPlan {
  if (!value || typeof value !== 'object') return failMigration('unsupported')
  const p = value as MigrationPlan
  if (Object.keys(p).sort().join() !== ['version', 'owners', 'localSource', 'localHash', 'versions', 'stores'].sort().join() || p.version !== 1 ||
    !Array.isArray(p.localSource) || p.localSource.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(x => typeof x !== 'string')) ||
    typeof p.localHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.localHash) || !Array.isArray(p.versions) || p.versions.length !== 2 || p.versions.some(v => v !== 0 && v !== 1) ||
    !Array.isArray(p.stores) || p.stores.length !== RAW_STORES.length || p.stores.some((s, i) => !s || s.store !== RAW_STORES[i] || !Number.isSafeInteger(s.count) || s.count < 0 || !/^[a-f0-9]{64}$/.test(s.hash))) failMigration('unsupported')
  localTargets(p, generation) // strict owners/keys/salts; never trust journal addresses
  return p
}
async function putRows(db: IDBPDatabase, store: RawStore, rows: RawRow[], guard: Attempt, outOfLine: boolean) {
  await transaction(db, [store], 'readwrite', guard, async tx => {
    const target = tx.objectStore(store)
    for (const row of rows) {
      guard.assertCurrent()
      if (await target.count(row.key)) {
        if (!equal(await target.get(row.key), row.value)) failMigration('changed')
      } else {
        guard.assertCurrent()
        await target.put(row.value, outOfLine || store === 'meta' ? row.key : undefined)
      }
    }
  })
}
async function attestStores(dbFor: (store: RawStore) => IDBPDatabase | null, plan: MigrationPlan, guard: Attempt) {
  for (const expected of plan.stores) {
    const actual = await scanRawStore(dbFor(expected.store), expected.store, guard.assertCurrent, guard.signal)
    if (!equal(actual, expected)) failMigration('changed')
  }
}

async function migrate(start: boolean, guard: Attempt, knownGeneration: string | undefined, remember: (generation: string) => void) {
  const initial = await readControl(guard)
  // A final transaction may commit before timeout/cancellation is observed.
  // Only this cold actor's known job can acknowledge that uncertain success.
  if (!start && knownGeneration && initial && typeof initial === 'object' && 'version' in initial && initial.version === 2) {
    const committed = await readWorkspaceStorageLayout(guard)
    if (committed.kind !== 'isolated-v1' || committed.generation !== knownGeneration) failMigration('changed')
    const journal = await openJournal({ format: 'arty-workspace-control', version: 3, layout: 'legacy-v1', state: 'migration',
      revision: 1, phase: 'verified', generation: knownGeneration }, guard)
    journal.close()
    return committed
  }
  let header = parseMigrationHeader(initial), initialPlan: MigrationPlan | undefined
  if (start) {
    if (initial !== null && validateWorkspaceControl(initial).kind !== 'legacy-v1') failMigration('unsupported')
    initialPlan = await readInventory(guard)
    if (initialPlan.versions.some(v => v > 1)) failMigration('unsupported')
    const generation = crypto.randomUUID(), layout = isolatedWorkspaceLayout(generation, initialPlan.owners)
    localTargets(initialPlan, generation) // missing/ambiguous crypto refuses before mutation
    for (const [name, shape] of [[migrationDatabaseName(generation), JOURNAL_SHAPE], [layout.files.name, FILE_SHAPE], [layout.projects.name, PROJECT_SHAPE]] as const) {
      const collision = await inspect(name, shape, guard)
      if (collision) { collision.close(); failMigration('collision') }
    }
    const revision = initial === null ? 1 : (initial as { revision: number }).revision + 1
    header = parseMigrationHeader({ format: 'arty-workspace-control', version: 3, layout: 'legacy-v1', state: 'migration', phase: 'reserved', generation, revision })
    if (!header) return failMigration('unsupported')
    remember(generation)
    await compareAndSwap(initial, header, guard, true)
  }
  if (!header) return failMigration('missing')
  remember(header.generation)
  const journal = await openJournal(header, guard)
  try {
    let value = await transaction(journal, ['journal'], 'readonly', guard, tx => tx.objectStore('journal').get('plan'))
    if (value === undefined) {
      if (header.phase !== 'reserved') failMigration('missing')
      const plan = initialPlan ?? await readInventory(guard)
      if (plan.versions.some(v => v > 1)) failMigration('missing')
      localTargets(plan, header.generation)
      await assertControl(header, guard)
      await transaction(journal, ['journal'], 'readwrite', guard, async tx => {
        if (await tx.objectStore('journal').count('plan')) failMigration('changed')
        await tx.objectStore('journal').put(plan, 'plan')
      })
      value = plan
    }
    const plan = validatePlan(value, header.generation), targets = localTargets(plan, header.generation)
    const current = await readInventory(guard, targets)
    sameInventory(plan, current)
    if (current.versions.some((v, i) => header!.phase === 'reserved' ? v !== plan.versions[i]
      : header!.phase === 'inventoried' ? v !== 2 && v !== plan.versions[i] : v !== 2)) failMigration('missing')
    await assertControl(header, guard)
    // Capacity is tested by real LS writes before either irreversible barrier.
    // Quota may leave a partial exact copy; journal permits retry, not deletion.
    for (const [key, value] of targets) {
      guard.assertCurrent()
      const old = localStorage.getItem(key)
      if (old !== null && old !== value) failMigration('changed')
      localStorage.setItem(key, value)
    }
    if (header.phase === 'reserved') header = await advance(header, 'inventoried', guard)
    for (const [name, shape] of [['arty-files', FILE_SHAPE], ['arty-projects', PROJECT_SHAPE]] as const) {
      await assertControl(header, guard)
      const db = await writable(name, 2, shape, guard); db.close()
    }
    sameInventory(plan, await readInventory(guard, targets))
    if (header.phase === 'inventoried') header = await advance(header, 'barrier', guard)
    const files = await inspect('arty-files', FILE_SHAPE, guard)
    let projects: IDBPDatabase | null = null
    try {
      projects = await inspect('arty-projects', PROJECT_SHAPE, guard)
      if (files?.version !== 2 || projects?.version !== 2) failMigration('missing')
      for (const store of RAW_STORES) {
        const actual = await scanRawStore(store === 'files' ? files : projects, store, guard.assertCurrent, guard.signal,
          rows => putRows(journal, store, rows, guard, true))
        if (!equal(actual, plan.stores.find(s => s.store === store))) failMigration('changed')
      }
    } finally { files?.close(); projects?.close() }
    await attestStores(() => journal, plan, guard)
    if (header.phase === 'barrier') header = await advance(header, 'copied', guard)
    const layout = isolatedWorkspaceLayout(header.generation, plan.owners)
    const destFiles = await writable(layout.files.name, 1, FILE_SHAPE, guard)
    let destProjects: IDBPDatabase | undefined
    try {
      destProjects = await writable(layout.projects.name, 1, PROJECT_SHAPE, guard)
      for (const store of RAW_STORES) await scanRawStore(journal, store, guard.assertCurrent, guard.signal,
        rows => putRows(store === 'files' ? destFiles : destProjects!, store, rows, guard, false))
      await attestStores(store => store === 'files' ? destFiles : destProjects!, plan, guard)
    } finally { destFiles.close(); destProjects?.close() }
    const finalLocal = localPairs()
    sameInventory(plan, await readInventory(guard, targets))
    const assertFinalLocal = () => {
      if (!equal(finalLocal, localPairs()) || targets.some(([key, value]) => localStorage.getItem(key) !== value)) failMigration('changed')
    }
    assertFinalLocal()
    if (header.phase === 'copied') header = await advance(header, 'verified', guard)
    if (header.phase !== 'verified') failMigration('unsupported')
    // Sole active-layout selection. Readers need a NEW admitted document.
    await compareAndSwap(header, { format: 'arty-workspace-control', version: 2, layout: 'isolated-v1', state: 'ready',
      revision: header.revision + 1, generation: header.generation, requiredOwners: plan.owners }, guard, false, assertFinalLocal)
    return layout
  } finally { journal.close() }
}
