import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { ISOLATED_WORKSPACE_ENABLED, WORKSPACE_RESTORE_START_ENABLED } from './activation'
import { workspaceAdmission } from './runtime'
import { validateWorkspaceControl, readWorkspaceStorageLayout, WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY, type AdmissionGuard } from './control'
import { isolatedWorkspaceLayout } from './layout'
import { assertDatabaseShape, createDatabaseShape, CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE, type StoreShape } from './schema'
import { parseMigrationHeader, migrationDatabaseName, type MigrationHeader, type MigrationPhase } from './migrationProtocol'
import { digestRaw, localPairs, localTargets, parseLegacySlot, validateSessions, observeLocalOwnerHints, observeRawOwner, scanRawStore,
  RAW_STORES, rawEncoding, failMigration, WorkspaceMigrationError, type MigrationPlan, type RawRow, type RawStore } from './migrationInventory'
import { parseErasureHeader, type ErasureHeader } from './erasureProtocol'
import { readErasureProof } from './erasure'
import { assertNativeErasureOwner } from '../native/coldMailErasure'
import { isNative } from '../native/platform'

const JOURNAL_SHAPE: readonly StoreShape[] = [['journal', null, []], ...RAW_STORES.map(name => [name, null, []] as const)]
const identity = (generation: string) => ({ format: 'arty-workspace-migration', version: 1, generation })
const equal = (a: unknown, b: unknown) => rawEncoding(a) === rawEncoding(b)
type Attempt = AdmissionGuard & { assertCurrent(): void }
interface CompletedMigration { header: Readonly<MigrationHeader>; plan: MigrationPlan; pairs: [string, string][] }
export interface ColdMigrationAccount { owner: string; label?: string }
function coldRunner(cold: AdmissionGuard) {
  let busy = false
  return async <T>(work: (guard: Attempt) => Promise<T>) => {
    if (busy) return failMigration('busy')
    cold.assertLock(); busy = true
    const aborter = new AbortController(), cancel = () => aborter.abort()
    cold.signal.addEventListener('abort', cancel, { once: true })
    let timer = setTimeout(cancel, 120_000)
    const guard: Attempt = { signal: aborter.signal, assertLock: cold.assertLock, assertCurrent() {
      cold.assertLock()
      if (!ISOLATED_WORKSPACE_ENABLED || cold.signal.aborted || aborter.signal.aborted) failMigration('cancelled')
      clearTimeout(timer); timer = setTimeout(cancel, 120_000)
    } }
    let reject!: (error: Error) => void
    const stopped = new Promise<never>((_resolve, no) => { reject = no })
    const stop = () => reject(new WorkspaceMigrationError('cancelled'))
    aborter.signal.addEventListener('abort', stop, { once: true })
    try { guard.assertCurrent(); return await Promise.race([work(guard), stopped]) }
    finally { cancel(); clearTimeout(timer); aborter.signal.removeEventListener('abort', stop); cold.signal.removeEventListener('abort', cancel); busy = false }
  }
}

/** A separate, irreversible choice in a new cold document. The complete
 * preview is private to this actor; callers cannot supply a plan or authority.
 * No deletion, crypto initialization or remote request happens here. */
export function createColdMigrationErasure() {
  if (!ISOLATED_WORKSPACE_ENABLED) return failMigration('disabled')
  const admitted = workspaceAdmission.getRecovery()
  if (!admitted) return failMigration('missing')
  const header = parseMigrationHeader(admitted)!, run = coldRunner(workspaceAdmission.claimMaintenance())
  let preview: CompletedMigration | undefined, selected: string | undefined, attempted: ErasureHeader | undefined
  return Object.freeze({
    inspect(): Promise<ColdMigrationAccount[]> { return run(async guard => {
      if (selected !== undefined) return failMigration('changed')
      const current = await readCompletedMigration(header, guard)
      if (preview && !equal(preview, current)) return failMigration('changed')
      preview ??= structuredClone(current)
      return migrationAccountLabels(preview)
    }) },
    confirm(owner: string): Promise<void> { return run(async guard => {
      if (!preview || typeof owner !== 'string' || !preview.plan.owners.includes(owner) || (selected !== undefined && owner !== selected)) return failMigration('changed')
      assertNativeErasureOwner(owner); selected = owner // bound before the first await, including retries
      const current = await readControl(guard)
      if (attempted && equal(current, attempted)) return // only this exact uncertain commit
      if (!equal(current, header) || !equal(await readCompletedMigration(header, guard), preview)) return failMigration('changed')
      const candidate = attempted ?? await migrationErasureCandidate(preview, owner, guard)
      // The readonly proof pass cannot silently adopt new source/destination bytes.
      if (!equal(await readCompletedMigration(header, guard), preview)) return failMigration('changed')
      attempted = candidate
      await compareAndSwap(header, candidate, guard, false, () => {
        if (!equal(preview!.pairs, localPairs())) failMigration('changed')
      })
    }) },
  })
}

interface PreparationSnapshot extends CompletedMigration { initialInventory: boolean; journalPresent: boolean; copies: unknown[] }
interface PreparationProgress {
  plan: MigrationPlan; initialPairs?: [string, string][]
  assertHeader(value: unknown): void
  stage(from: Readonly<MigrationHeader>, to: Readonly<MigrationHeader>): void
  acknowledge(header: Readonly<MigrationHeader>): void
}
/** Explicit copy preparation ONLY. Its destination is immutable: v3 verified,
 * never ready. Neither the preview nor a caller supplies a writable address,
 * owner, baseline or activation boolean. Erasure requires another document. */
export function createColdErasurePreparation() {
  if (!ISOLATED_WORKSPACE_ENABLED) return failMigration('disabled')
  const admitted = workspaceAdmission.getRecovery()
  if (!admitted) return failMigration('missing')
  const header = parseMigrationHeader(admitted)!, run = coldRunner(workspaceAdmission.claimMaintenance())
  let preview: PreparationSnapshot | undefined, started = false, acknowledged = header
  let transition: { from: Readonly<MigrationHeader>; to: Readonly<MigrationHeader> } | undefined
  const assertHeader = (value: unknown) => {
    if (!equal(value, acknowledged) && !(transition && equal(value, transition.to))) failMigration('changed')
  }
  return Object.freeze({
    inspect(): Promise<{ initialInventory: boolean }> { return run(async guard => {
      if (started) return failMigration('changed')
      const current = await readPreparationSnapshot(header, guard)
      if (preview && !equal(preview, current)) return failMigration('changed')
      preview ??= structuredClone(current)
      return { initialInventory: preview.initialInventory }
    }) },
    prepare(): Promise<void> { return run(async guard => {
      if (!preview) return failMigration('missing')
      const value = await readControl(guard); assertHeader(value)
      const currentHeader = parseMigrationHeader(value) ?? failMigration('changed')
      const current = await readPreparationSnapshot(currentHeader, guard)
      if (!equal(current.plan, preview.plan) || (!preview.initialInventory && current.initialInventory) || (!started && !equal(current, preview))) return failMigration('changed')
      started = true
      if (currentHeader.phase === 'verified') {
        const completed = await readCompletedMigration(currentHeader, guard)
        if (!equal(completed.plan, preview.plan)) return failMigration('changed')
        acknowledged = currentHeader; transition = undefined; return // readonly uncertain-commit acknowledgement
      }
      if (transition && equal(currentHeader, transition.to)) { acknowledged = currentHeader; transition = undefined }
      const progress: PreparationProgress = {
        plan: preview.plan, ...(preview.initialInventory ? { initialPairs: preview.pairs } : {}), assertHeader,
        stage(from, to) {
          if (!equal(from, acknowledged) || (transition && (!equal(from, transition.from) || !equal(to, transition.to)))) failMigration('changed')
          transition = { from: structuredClone(from), to: structuredClone(to) }
        },
        acknowledge(next) { if (!transition || !equal(next, transition.to)) failMigration('changed'); acknowledged = next; transition = undefined },
      }
      await migrate(false, guard, undefined, () => {}, progress)
    }) },
  })
}

async function readPreparationSnapshot(header: Readonly<MigrationHeader>, guard: Attempt): Promise<PreparationSnapshot> {
  const snapshot = await readMigrationSnapshot(header, guard)
  if (!snapshot.plan.owners.some(owner => { if (owner === null) return false; try { assertNativeErasureOwner(owner); return true } catch { return false } })) return failMigration('no-account')
  return snapshot
}

/** One confirmed attempt, including failures and uncertain commits. Only a new
 * cold document can inspect a new baseline after the private plan is removed.
 * Sources are never written; this is NOT restoration or account erasure. */
export function createColdMigrationCancellation() {
  if (!ISOLATED_WORKSPACE_ENABLED) return failMigration('disabled')
  const admitted = workspaceAdmission.getRecovery()
  if (!admitted) return failMigration('missing')
  const header = parseMigrationHeader(admitted)!, run = coldRunner(workspaceAdmission.claimMaintenance())
  let preview: PreparationSnapshot | undefined, attempted = false
  const snapshot = async (guard: Attempt) => {
    if (header.phase !== 'reserved') return failMigration('unsupported')
    return readMigrationSnapshot(header, guard)
  }
  return Object.freeze({
    inspect(): Promise<{ initialInventory: boolean }> { return run(async guard => {
      if (attempted) return failMigration('changed')
      const current = await snapshot(guard)
      if (attempted || (preview && !equal(preview, current))) return failMigration('changed')
      preview ??= structuredClone(current)
      return { initialInventory: preview.initialInventory }
    }) },
    async confirm(): Promise<void> {
      if (attempted) return failMigration('changed')
      attempted = true // synchronous, before run/await; coldRunner's busy is not revocation
      return run(async guard => {
        if (!preview) return failMigration('missing')
        const expected = structuredClone(preview)
        if (!equal(await snapshot(guard), expected)) return failMigration('changed')
        const assertLocal = () => { guard.assertCurrent(); if (!equal(expected.pairs, localPairs())) failMigration('changed') }
        for (const [key, value] of localTargets(expected.plan, header.generation)) {
          await assertControl(header, guard); assertLocal()
          const present = localStorage.getItem(key)
          if (present !== null) {
            if (present !== value) return failMigration('changed')
            localStorage.removeItem(key)
            expected.pairs = expected.pairs.filter(([k]) => k !== key)
            assertLocal()
          }
        }
        if (!equal(await snapshot(guard), expected)) return failMigration('changed')
        const journal = await inspect(migrationDatabaseName(header.generation), JOURNAL_SHAPE, guard)
        try {
          if (!!journal !== expected.journalPresent) return failMigration('changed')
          if (journal) {
            if (journal.version !== 1) return failMigration('unsupported')
            // Snapshot reads do not lock raw stores. Recheck all of them in the
            // SAME transaction as plan removal, so no private fragment is orphaned.
            await transaction(journal, ['journal', ...RAW_STORES], 'readwrite', guard, async tx => {
              const store = tx.objectStore('journal')
              if (!equal(await store.getAllKeys(), expected.initialInventory ? ['identity'] : ['identity', 'plan']) ||
                !equal(await store.get('identity'), identity(header.generation)) ||
                !equal(await store.get('plan'), expected.initialInventory ? undefined : expected.plan)) return failMigration('changed')
              for (const name of RAW_STORES) if (await tx.objectStore(name).count() !== 0) return failMigration('changed')
              assertLocal()
              if (!expected.initialInventory) await store.delete('plan')
            })
          }
        } finally { journal?.close() }
        expected.initialInventory = true
        // Keep the captured source baseline through our own cleanup. Never adopt
        // a new one in this actor, including after a lost transaction acknowledgement.
        if (!equal(await snapshot(guard), expected)) return failMigration('changed')
        await compareAndSwap(header, { format: 'arty-workspace-control', version: 1, layout: 'legacy-v1', state: 'ready',
          revision: header.revision + 1 }, guard, false, assertLocal)
        // Maintenance remains terminal in this document. A voluntary reload is required.
      })
    },
  })
}

/** Snapshot partial copies without creating them or claiming they are complete.
 * A missing first plan is admissible only before ANY copying has begun. */
async function readMigrationSnapshot(header: Readonly<MigrationHeader>, guard: Attempt): Promise<PreparationSnapshot> {
  if (header.revision > Number.MAX_SAFE_INTEGER - 24) return failMigration('unsupported')
  await assertControl(header, guard)
  const journal = await inspect(migrationDatabaseName(header.generation), JOURNAL_SHAPE, guard)
  let files: IDBPDatabase | null = null, projects: IDBPDatabase | null = null
  try {
    let plan: MigrationPlan | undefined
    if (journal) {
      if (journal.version !== 1) return failMigration('unsupported')
      plan = await transaction(journal, ['journal'], 'readonly', guard, async tx => {
        const store = tx.objectStore('journal'), keys = await store.getAllKeys(), value = await store.get('plan')
        if (!equal(await store.get('identity'), identity(header.generation)) || !equal(keys, value === undefined ? ['identity'] : ['identity', 'plan'])) return failMigration('missing')
        if (value === undefined) return undefined
        rawEncoding(value); return validatePlan(value, header.generation)
      })
    }
    const initialInventory = !plan, layout = isolatedWorkspaceLayout(header.generation, [])
    files = await inspect(layout.files.name, FILE_SHAPE, guard); projects = await inspect(layout.projects.name, PROJECT_SHAPE, guard)
    if ((files && files.version !== 1) || (projects && projects.version !== 1)) return failMigration('unsupported')
    const copies: unknown[] = [], journalRows = []
    for (const store of RAW_STORES) journalRows.push(await scanRawStore(journal, store, guard.assertCurrent, guard.signal))
    copies.push({ name: 'journal', present: !!journal, stores: journalRows })
    for (const [name, db, stores] of [['files', files, ['files']], ['projects', projects, ['projects', 'documents', 'usage', 'meta']]] as const) {
      const rows = []
      for (const store of stores) rows.push(await scanRawStore(db, store, guard.assertCurrent, guard.signal))
      copies.push({ name, present: !!db, stores: rows })
    }
    if (!plan && (header.phase !== 'reserved' || files || projects || journalRows.some(s => s.count !== 0))) return failMigration('missing')
    if (plan && ((header.phase === 'reserved' || header.phase === 'inventoried') && journalRows.some(s => s.count !== 0))) return failMigration('changed')
    if (header.phase !== 'copied' && header.phase !== 'verified' && (files || projects)) return failMigration('collision')
    const pairs = localPairs(), current = await readInventory(guard, plan ? localTargets(plan, header.generation) : [])
    if (plan) sameInventory(plan, current)
    else { plan = current; localTargets(plan, header.generation) }
    if (current.versions.some((v, i) => header.phase === 'reserved' ? v !== plan!.versions[i] || v > 1
      : header.phase === 'inventoried' ? v !== 2 && v !== plan!.versions[i] : v !== 2)) return failMigration('missing')
    if ((header.phase === 'copied' || header.phase === 'verified') && !equal(journalRows, plan.stores)) return failMigration('changed')
    await assertControl(header, guard)
    if (!equal(pairs, localPairs())) return failMigration('changed')
    return { header, plan, pairs, copies, initialInventory, journalPresent: !!journal }
  } finally { journal?.close(); files?.close(); projects?.close() }
}

function migrationAccountLabels(snapshot: CompletedMigration): ColdMigrationAccount[] {
  const raw = new Map(snapshot.pairs).get('arty-known-sessions')
  const sessions: { userId: string; displayName?: unknown }[] = raw ? JSON.parse(raw) : []
  const labelsByOwner = new Map<string, Set<unknown>>()
  for (const session of sessions) {
    const labels = labelsByOwner.get(session.userId) ?? new Set<unknown>()
    labels.add(session.displayName); labelsByOwner.set(session.userId, labels)
  }
  return snapshot.plan.owners.filter((owner): owner is string => owner !== null).map(owner => {
    const labels = labelsByOwner.get(owner)
    const label = labels?.size === 1 ? [...labels][0] : undefined
    return { owner, ...(typeof label === 'string' && label.length > 0 && label.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(label) ? { label } : {}) }
  })
}

/** Readonly only: never resume(), writable(), putRows() or a new baseline.
 * copied denotes a complete JOURNAL, so destination presence is checked too. */
async function readCompletedMigration(header: Readonly<MigrationHeader>, guard: Attempt): Promise<CompletedMigration> {
  if ((header.phase !== 'copied' && header.phase !== 'verified') || header.revision > Number.MAX_SAFE_INTEGER - 24) return failMigration('missing')
  await assertControl(header, guard)
  const journal = await inspect(migrationDatabaseName(header.generation), JOURNAL_SHAPE, guard)
  let files: IDBPDatabase | null = null, projects: IDBPDatabase | null = null
  try {
    if (!journal || journal.version !== 1) return failMigration('missing')
    const plan = await transaction(journal, ['journal'], 'readonly', guard, async tx => {
      const store = tx.objectStore('journal'), value = await store.get('plan')
      if (!equal(await store.getAllKeys(), ['identity', 'plan']) || !equal(await store.get('identity'), identity(header.generation))) return failMigration('missing')
      rawEncoding(value); return validatePlan(value, header.generation)
    })
    const layout = isolatedWorkspaceLayout(header.generation, plan.owners), targets = localTargets(plan, header.generation)
    const pairs = localPairs(), current = await readInventory(guard, targets)
    sameInventory(plan, current)
    if (current.versions.some(v => v !== 2) || targets.some(([key, value]) => localStorage.getItem(key) !== value)) return failMigration('missing')
    await attestStores(() => journal, plan, guard, true)
    files = await inspect(layout.files.name, FILE_SHAPE, guard); projects = await inspect(layout.projects.name, PROJECT_SHAPE, guard)
    if (!files || !projects || files.version !== 1 || projects.version !== 1) return failMigration('missing')
    await attestStores(store => store === 'files' ? files : projects, plan, guard, true)
    sameInventory(plan, await readInventory(guard, targets)); await assertControl(header, guard)
    if (!equal(pairs, localPairs()) || targets.some(([key, value]) => localStorage.getItem(key) !== value)) return failMigration('changed')
    return { header, plan, pairs }
  } finally { journal?.close(); files?.close(); projects?.close() }
}

/** Private builder: receives only the actor's fully attested snapshot. */
async function migrationErasureCandidate(snapshot: CompletedMigration, owner: string, guard: Attempt): Promise<ErasureHeader> {
  const { header, plan } = snapshot, layout = isolatedWorkspaceLayout(header.generation, plan.owners)
  const opened: IDBPDatabase[] = []
  const required = async (name: string, version: number, shape: readonly StoreShape[]) => {
    const db = await inspect(name, shape, guard)
    if (!db) return failMigration('missing')
    opened.push(db); if (db.version !== version) return failMigration('changed'); return db
  }
  try {
    const copies = [
      { copy: 'legacy' as const, files: await required('arty-files', 2, FILE_SHAPE), projects: await required('arty-projects', 2, PROJECT_SHAPE) },
      { copy: 'active' as const, files: await required(layout.files.name, 1, FILE_SHAPE), projects: await required(layout.projects.name, 1, PROJECT_SHAPE) },
    ]
    const journal = await required(migrationDatabaseName(header.generation), 1, JOURNAL_SHAPE)
    const initialLocal = localStorage.getItem('arty-project-erasure-fence')
    const initialActive = await transaction(copies[1]!.projects, ['meta'], 'readonly', guard, async tx => {
      const cursor = await tx.objectStore('meta').openCursor('erasure-fence'); return cursor ? cursor.value : null
    })
    const operationId = crypto.randomUUID(), nonce = crypto.randomUUID(), target = crypto.randomUUID(), resetId = crypto.randomUUID()
    const candidate: ErasureHeader = { format: 'arty-workspace-control', version: 6, layout: 'isolated-v1', state: 'erasing',
      revision: header.revision + 1, generation: header.generation, requiredOwners: [...plan.owners], resets: [],
      erasure: { owner, operationId, nonce, phase: 'reserved', proof: undefined!, fence: { initialLocal, initialActive, target },
        authority: { owner, operationId, nonce, serverConfirmed: false, localOnly: true, pending: [] }, reset: { resetId, previousResetId: null } } }
    candidate.erasure.proof = (await readErasureProof([...copies, { copy: 'journal', files: journal, projects: journal }], journal, candidate, guard)).value
    return parseErasureHeader(candidate) ?? failMigration('changed')
  } finally { opened.forEach(db => db.close()) }
}

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
    if (start && !WORKSPACE_RESTORE_START_ENABLED) return failMigration('disabled')
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
  return Object.freeze({ start: () => { if (isNative) return Promise.reject(new WorkspaceMigrationError('disabled')); return run(true) }, resume: () => run(false) })
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
async function advance(header: Readonly<MigrationHeader>, phase: MigrationPhase, guard: Attempt, beforePut?: () => void, preparation?: PreparationProgress): Promise<Readonly<MigrationHeader>> {
  const next = { ...header, revision: header.revision + 1, phase }
  preparation?.stage(header, next)
  await compareAndSwap(header, next, guard, false, beforePut)
  preparation?.acknowledge(next)
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
async function attestStores(dbFor: (store: RawStore) => IDBPDatabase | null, plan: MigrationPlan, guard: Attempt, classifyIncomplete = false) {
  for (const expected of plan.stores) {
    const actual = await scanRawStore(dbFor(expected.store), expected.store, guard.assertCurrent, guard.signal)
    if (!equal(actual, expected)) failMigration(classifyIncomplete && actual.count < expected.count ? 'missing' : 'changed')
  }
}

async function migrate(start: boolean, guard: Attempt, knownGeneration: string | undefined, remember: (generation: string) => void, preparation?: PreparationProgress) {
  const initial = await readControl(guard)
  preparation?.assertHeader(initial)
  // A final transaction may commit before timeout/cancellation is observed.
  // Only this cold actor's known job can acknowledge that uncertain success.
  if (!preparation && !start && knownGeneration && initial && typeof initial === 'object' && 'version' in initial && initial.version === 2) {
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
      if (preparation && !preparation.initialPairs) return failMigration('missing')
      const plan = preparation?.plan ?? initialPlan ?? await readInventory(guard)
      if (plan.versions.some(v => v > 1)) failMigration('missing')
      localTargets(plan, header.generation)
      if (preparation) sameInventory(plan, await readInventory(guard))
      await assertControl(header, guard)
      await transaction(journal, ['journal'], 'readwrite', guard, async tx => {
        if (await tx.objectStore('journal').count('plan')) failMigration('changed')
        if (preparation && !equal(preparation.initialPairs, localPairs())) failMigration('changed')
        await tx.objectStore('journal').put(plan, 'plan')
      })
      value = plan
    }
    const plan = validatePlan(value, header.generation), targets = localTargets(plan, header.generation)
    if (preparation && !equal(plan, preparation.plan)) return failMigration('changed')
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
    if (header.phase === 'reserved') header = await advance(header, 'inventoried', guard, undefined, preparation)
    for (const [name, shape] of [['arty-files', FILE_SHAPE], ['arty-projects', PROJECT_SHAPE]] as const) {
      await assertControl(header, guard)
      const db = await writable(name, 2, shape, guard); db.close()
    }
    sameInventory(plan, await readInventory(guard, targets))
    if (header.phase === 'inventoried') header = await advance(header, 'barrier', guard, undefined, preparation)
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
    if (header.phase === 'barrier') header = await advance(header, 'copied', guard, undefined, preparation)
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
    if (header.phase === 'copied') header = await advance(header, 'verified', guard, assertFinalLocal, preparation)
    if (header.phase !== 'verified') failMigration('unsupported')
    if (preparation) {
      const completed = await readCompletedMigration(header, guard)
      if (!equal(completed.plan, preparation.plan)) return failMigration('changed')
      guard.assertCurrent(); assertFinalLocal(); return layout
    }
    // Sole active-layout selection. Readers need a NEW admitted document.
    await compareAndSwap(header, { format: 'arty-workspace-control', version: 2, layout: 'isolated-v1', state: 'ready',
      revision: header.revision + 1, generation: header.generation, requiredOwners: plan.owners }, guard, false, assertFinalLocal)
    return layout
  } finally { journal.close() }
}
