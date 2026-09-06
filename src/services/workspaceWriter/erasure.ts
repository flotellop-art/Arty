import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { assertNativeErasureOwner, clearColdMailScope } from '../native/coldMailErasure'
import { ISOLATED_WORKSPACE_ENABLED } from './activation'
import { workspaceAdmission } from './runtime'
import { validateWorkspaceControl, WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY, type AdmissionGuard } from './control'
import { isolatedWorkspaceLayout } from './layout'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE, MIGRATION_JOURNAL_SHAPE, assertDatabaseShape, type StoreShape } from './schema'
import { migrationDatabaseName } from './migrationProtocol'
import { parseErasureHeader, validErasureFence, type ErasureHeader, type ErasureProof, type ErasureStoreProof } from './erasureProtocol'
import { parseResetReadyControl, type ResetRecord } from './resetProtocol'
import { parseAccountErasureRecord, type AccountErasureRecord } from '../accountErasureJournal'
import { consultErasureReceipt } from '../accountErasureReceipt'
import { RAW_STORES, scanRawStore, digestRaw, digestText, localPairs } from './migrationInventory'
import { equalErasure as equal, refuseErasure as refuse, projectErasurePlan, erasureLocalSnapshot, erasureRowOwner } from './erasureInventory'

type Attempt = AdmissionGuard & { assertCurrent(): void }
type Copy = { copy: ErasureStoreProof['copy']; files: IDBPDatabase; projects: IDBPDatabase }
type Snapshot = { control: unknown; receipt?: AccountErasureRecord | null }
type Bind = (snapshot: Snapshot, generation: string, stage?: boolean) => void
export type ColdErasureAction = 'resume' | 'local-only' | 'cancel-not-sent'
const FENCE_KEY = 'arty-project-erasure-fence'
/** Actual cold singleton + intrinsic OFF gate. GET receipt only, never login,
 * POST, KDF or private App import. A v6 final commit grants one local reset;
 * historical v4/v5 completions grant none. Local-only requires
 * a distinct UI confirmation; it cannot manufacture remote confirmation. */
export function createColdWorkspaceErasure() {
  if (!ISOLATED_WORKSPACE_ENABLED) throw new Error('workspace_erasure_disabled')
  const cold = workspaceAdmission.claimMaintenance()
  let busy = false, knownFinal: unknown, knownCancellation: unknown
  let accepted: Snapshot[] = []
  const bind: Bind = (snapshot, generation, stage = false) => {
    if (stage) { accepted = [accepted[accepted.length - 1]!, structuredClone(snapshot)]; return }
    if (!accepted.length) workspaceAdmission.assertErasureSnapshot(generation, snapshot.receipt ?? snapshot.control)
    else if (!accepted.some(v => equal(v, snapshot))) return refuse()
    accepted = [structuredClone(snapshot)]
  }
  return Object.freeze({ async resume(action: ColdErasureAction = 'resume') {
    if (!ISOLATED_WORKSPACE_ENABLED) throw new Error('workspace_erasure_disabled')
    cold.assertLock()
    if (busy) throw new Error('workspace_erasure_busy')
    busy = true
    const aborter = new AbortController(), cancel = () => aborter.abort()
    cold.signal.addEventListener('abort', cancel, { once: true })
    let timeout = setTimeout(cancel, 120_000)
    const guard: Attempt = { signal: aborter.signal, assertLock: cold.assertLock, assertCurrent() {
      cold.assertLock()
      if (!ISOLATED_WORKSPACE_ENABLED || cold.signal.aborted || aborter.signal.aborted) throw new Error('workspace_erasure_cancelled')
      clearTimeout(timeout); timeout = setTimeout(cancel, 120_000)
    } }
    let rejectStop!: (reason: Error) => void
    const stopped = new Promise<never>((_yes, no) => { rejectStop = no })
    const stop = () => rejectStop(new Error('workspace_erasure_cancelled'))
    aborter.signal.addEventListener('abort', stop, { once: true })
    try { return await Promise.race([erase(guard, knownFinal, v => { knownFinal = v }, action, bind, knownCancellation, v => { knownCancellation = v }), stopped]) }
    finally { cancel(); clearTimeout(timeout); cold.signal.removeEventListener('abort', cancel); aborter.signal.removeEventListener('abort', stop); busy = false }
  } })
}
async function transaction<T, M extends 'readonly' | 'readwrite'>(db: IDBPDatabase, stores: string[], mode: M, guard: Attempt,
  work: (tx: IDBPTransaction<unknown, string[], M>) => Promise<T>): Promise<T> {
  guard.assertCurrent()
  const tx = db.transaction(stores, mode), abort = () => { try { tx.abort() } catch { /* settled */ } }
  guard.signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
  try { const result = await work(tx); guard.assertCurrent(); await tx.done; guard.assertCurrent(); return result }
  catch (error) { abort(); await tx.done.catch(() => {}); throw error }
  finally { guard.signal.removeEventListener('abort', abort) }
}
async function inspect(name: string, version: number, shape: readonly StoreShape[], guard: Attempt) {
  const db = await openExistingDB(name, version, guard.assertCurrent, guard.signal)
  if (!db) return refuse()
  try {
    if (db.version !== version) return refuse()
    await transaction(db, shape.map(s => s[0]), 'readonly', guard, async tx => { assertDatabaseShape(db, shape, tx) })
    return db
  } catch (error) { db.close(); throw error }
}
async function control(guard: Attempt) {
  const db = await inspect(WORKSPACE_CONTROL_DB, 1, CONTROL_SHAPE, guard)
  try { return await transaction(db, ['meta'], 'readonly', guard, async tx => {
    if (await tx.objectStore('meta').count() !== 1) return refuse()
    return tx.objectStore('meta').get(WORKSPACE_CONTROL_KEY)
  }) } finally { db.close() }
}
async function cas(expected: unknown, next: unknown, guard: Attempt, beforePut?: () => void) {
  const db = await inspect(WORKSPACE_CONTROL_DB, 1, CONTROL_SHAPE, guard)
  try { await transaction(db, ['meta'], 'readwrite', guard, async tx => {
    if (await tx.objectStore('meta').count() !== 1 || !equal(await tx.objectStore('meta').get(WORKSPACE_CONTROL_KEY), expected)) return refuse()
    guard.assertCurrent(); beforePut?.(); await tx.objectStore('meta').put(next, WORKSPACE_CONTROL_KEY)
  }) } finally { db.close() }
}
async function readPlan(job: IDBPDatabase, generation: string, guard: Attempt) {
  return transaction(job, ['journal'], 'readonly', guard, async tx => {
    if (!equal(await tx.objectStore('journal').getAllKeys(), ['identity', 'plan']) || !equal(await tx.objectStore('journal').get('identity'), { format: 'arty-workspace-migration', version: 1, generation })) return refuse()
    return tx.objectStore('journal').get('plan')
  })
}
async function readReceipts(tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>, guard: Attempt) {
  const receipts: AccountErasureRecord[] = []
  let cursor = await tx.objectStore('meta').openCursor()
  while (cursor) {
    guard.assertCurrent()
    if (Array.isArray(cursor.key) && cursor.key[0] === 'erasing') {
      const receipt = parseAccountErasureRecord(cursor.value)
      if (!receipt || cursor.key.length !== 2 || cursor.key[1] !== receipt.owner) return refuse()
      receipts.push(receipt)
    }
    cursor = await cursor.continue()
  }
  return receipts
}
async function replaceReceipt(db: IDBPDatabase, initial: unknown, expected: AccountErasureRecord, next: AccountErasureRecord | null, guard: Attempt, expectedFences?: [string | null, string | null]) {
  // Separate DBs: guarded before/after checks, NOT an atomic cross-DB CAS.
  if (!equal(await control(guard), initial)) return refuse()
  await transaction(db, ['meta'], 'readwrite', guard, async tx => {
    if (!equal(await readReceipts(tx, guard), [expected])) return refuse()
    if (!next) {
      if (!expectedFences) return refuse()
      const cursor = await tx.objectStore('meta').openCursor('erasure-fence')
      if ((cursor && !validErasureFence(cursor.value)) || !equal(cursor ? cursor.value : null, expectedFences[1]) || localStorage.getItem(FENCE_KEY) !== expectedFences[0]) return refuse()
    }
    guard.assertCurrent()
    if (next) await tx.objectStore('meta').put(next, ['erasing', expected.owner])
    else await tx.objectStore('meta').delete(['erasing', expected.owner])
  })
  if (!equal(await control(guard), initial)) return refuse()
}
async function fences(db: IDBPDatabase, guard: Attempt): Promise<[string | null, string | null]> {
  const active = await transaction(db, ['meta'], 'readonly', guard, async tx => {
    const cursor = await tx.objectStore('meta').openCursor('erasure-fence')
    if (!cursor) return null
    if (!validErasureFence(cursor.value)) return refuse()
    return cursor.value as string
  })
  const local = localStorage.getItem(FENCE_KEY)
  if (local !== null && !validErasureFence(local)) return refuse()
  return [local, active]
}
async function attestFences(db: IDBPDatabase, header: ErasureHeader, guard: Attempt) {
  if (header.version === 4) return undefined
  const pair = await fences(db, guard), { initialLocal: l, initialActive: d, target: t } = header.erasure.fence
  const allowed = header.erasure.phase === 'reserved' ? [[l, d], [l, t], [t, t]] : [[t, t]]
  if (!allowed.some(p => equal(p, pair))) return refuse()
  return pair
}
/** Internal readonly projector shared with the v3 supersession actor. It grants
 * no authority, constructs no header and exposes no control writer. */
export async function readErasureProof(copies: Copy[], job: IDBPDatabase, header: ErasureHeader, guard: Attempt): Promise<{ value: ErasureProof; absent: boolean }> {
  await attestFences(copies[1]!.projects, header, guard)
  const local = await erasureLocalSnapshot(header.generation, header.erasure.owner, header.version)
  guard.assertCurrent()
  const plan = await readPlan(job, header.generation, guard), redacted = projectErasurePlan(plan, header.generation, header.erasure.owner)
  let absent = !local.changes.length && equal(plan, redacted)
  const stores: ErasureStoreProof[] = []
  for (const copy of copies) {
    let fence: string | undefined
    for (const store of RAW_STORES) {
      const repairedStore = header.version !== 4 && copy.copy === 'active' && store === 'meta'
      let hash = await digestText(repairedStore ? 'arty-erasure-protected-active-meta-v5' : 'arty-erasure-protected-store-v1'), count = 0
      await scanRawStore(store === 'files' ? copy.files : copy.projects, store, guard.assertCurrent, guard.signal, async rows => {
        for (const row of rows) {
          if (repairedStore && row.key === 'erasure-fence') { if (!validErasureFence(row.value)) return refuse(); continue }
          if (erasureRowOwner(store, row, header.erasure) === header.erasure.owner) absent = false
          else { hash = await digestText(JSON.stringify([hash, await digestRaw([row.key, row.value])])); count++ }
          if (store === 'meta' && row.key === 'erasure-fence') fence = row.value as string
          guard.assertCurrent()
        }
      })
      stores.push({ copy: copy.copy, store, hash, count })
    }
    if (header.version === 4 && copy.copy === 'active' && (fence ?? 'initial') !== (localStorage.getItem(FENCE_KEY) ?? 'initial')) return refuse()
  }
  await attestFences(copies[1]!.projects, header, guard)
  return { value: { localHash: local.hash, planHash: await digestRaw(redacted), stores }, absent }
}
async function erase(guard: Attempt, knownFinal: unknown, remember: (v: unknown) => void, action: ColdErasureAction,
  bind: Bind, knownCancellation: unknown, rememberCancellation: (v: unknown) => void) {
  const initial = await control(guard)
  // Only an exact final record attempted by this actor can acknowledge a lost
  // commit response. No arbitrary v2 generation implies completed erasure.
  if (knownFinal && equal(initial, knownFinal)) return validateWorkspaceControl(initial)
  let header = parseErasureHeader(initial)
  if (header && action === 'cancel-not-sent') return refuse()
  const layout = header ? isolatedWorkspaceLayout(header.generation, header.requiredOwners) : validateWorkspaceControl(initial)
  if (layout.kind !== 'isolated-v1') return refuse()
  if (header) bind({ control: initial }, layout.generation)
  const opened: IDBPDatabase[] = []
  const open = async (name: string, version: number, shape: readonly StoreShape[]) => {
    const db = await inspect(name, version, shape, guard); opened.push(db); return db
  }
  try {
    const copies: Copy[] = [
      { copy: 'legacy', files: await open('arty-files', 2, FILE_SHAPE), projects: await open('arty-projects', 2, PROJECT_SHAPE) },
      { copy: 'active', files: await open(layout.files.name, 1, FILE_SHAPE), projects: await open(layout.projects.name, 1, PROJECT_SHAPE) },
    ]
    const job = await open(migrationDatabaseName(layout.generation), 1, MIGRATION_JOURNAL_SHAPE)
    copies.push({ copy: 'journal', files: job, projects: job })
    if (!header) {
      const active = copies[1]!.projects
      const receipts = await transaction(active, ['meta'], 'readonly', guard, tx => readReceipts(tx, guard))
      if (action === 'cancel-not-sent' && !receipts.length && knownCancellation && equal(initial, knownCancellation)) {
        bind({ control: initial, receipt: null }, layout.generation); return layout
      }
      if (receipts.length !== 1) return refuse()
      let receipt = receipts[0]!
      bind({ control: initial, receipt }, layout.generation)
      if (action === 'cancel-not-sent') {
        const pair = await fences(active, guard)
        if (receipt.serverConfirmed || receipt.localOnly || receipt.remote?.state !== 'not-sent' || receipt.pending.length || (pair[0] ?? 'initial') !== (pair[1] ?? 'initial')) return refuse()
        bind({ control: initial, receipt: null }, layout.generation, true); rememberCancellation(initial)
        await replaceReceipt(active, initial, receipt, null, guard, pair)
        return layout // no purge, no network; only a new document may open App
      }
      if (!receipt.serverConfirmed && !receipt.localOnly) {
        if (action === 'local-only') {
          const next = { ...receipt, localOnly: true as const }
          bind({ control: initial, receipt: next }, layout.generation, true)
          await replaceReceipt(active, initial, receipt, next, guard); receipt = next
        } else {
          if (receipt.remote?.state !== 'uncertain') throw new Error('workspace_erasure_choice_required')
          await consultErasureReceipt(receipt.operationId, receipt.remote, guard.signal); guard.assertCurrent()
          const next: AccountErasureRecord = { owner: receipt.owner, operationId: receipt.operationId, nonce: receipt.nonce, serverConfirmed: true, pending: [] }
          bind({ control: initial, receipt: next }, layout.generation, true)
          await replaceReceipt(active, initial, receipt, next, guard); receipt = next
        }
      }
      const requiredOwners = [...new Set([...layout.requiredOwners, receipt.owner])]
      if (initial.revision > Number.MAX_SAFE_INTEGER - 24) return refuse()
      isolatedWorkspaceLayout(layout.generation, requiredOwners) // bound before mutation
      assertNativeErasureOwner(receipt.owner)
      const pair = await fences(active, guard)
      const target = crypto.randomUUID()
      // Do not loop on a broken RNG. A fresh target is essential to the grammar.
      if (pair.includes(target)) return refuse()
      const previous = parseResetReadyControl(initial)
      const priorReset = previous?.resets.find(r => r.owner === receipt.owner)
      // A pending allocation cannot be replaced by an unrelated hot receipt.
      // It must first be finished by explicit login using its fixed bundle.
      if (priorReset && priorReset.phase !== 'consumed') return refuse()
      const resets = previous?.resets.filter(r => r.owner !== receipt.owner) ?? []
      const resetId = crypto.randomUUID()
      if (resetId === priorReset?.resetId || resets.some(r => r.resetId === resetId)) return refuse()
      const identity = { owner: receipt.owner, operationId: receipt.operationId, nonce: receipt.nonce, phase: 'reserved' as const, proof: undefined! }
      const candidate: ErasureHeader = { format: 'arty-workspace-control', layout: 'isolated-v1', state: 'erasing',
        generation: layout.generation, revision: initial.revision + 1, requiredOwners,
        version: 6, resets, erasure: { ...identity, authority: receipt, fence: { initialLocal: pair[0], initialActive: pair[1], target },
          reset: { resetId, previousResetId: priorReset?.resetId ?? null } } }
      candidate.erasure.proof = (await readErasureProof(copies, job, candidate, guard)).value
      header = parseErasureHeader(candidate)
      if (!header) return refuse()
      if (!equal(pair, await fences(active, guard)) || !equal(await transaction(active, ['meta'], 'readonly', guard, tx => readReceipts(tx, guard)), [receipt])) return refuse()
      bind({ control: header }, layout.generation, true)
      await cas(initial, header, guard)
    }
    assertNativeErasureOwner(header.erasure.owner)
    const attest = async (requireAbsent = false) => {
      if (!equal(await control(guard), header)) return refuse()
      const current = await readErasureProof(copies, job, header!, guard)
      if (!equal(current.value, header!.erasure.proof) || (requireAbsent && !current.absent)) return refuse()
    }
    const advance = async (phase: ErasureHeader['erasure']['phase']) => {
      const next = parseErasureHeader({ ...header, revision: header!.revision + 1, erasure: { ...header!.erasure, phase } })
      if (!next) return refuse()
      bind({ control: next }, layout.generation, true)
      await cas(header, next, guard); header = next
    }
    await attest()
    if (header.version !== 4 && header.erasure.phase === 'reserved') {
      const active = copies[1]!.projects, pair = (await attestFences(active, header, guard))!, target = header.erasure.fence.target
      if (pair[1] !== target) {
        await transaction(active, ['meta'], 'readwrite', guard, async tx => {
          const cursor = await tx.objectStore('meta').openCursor('erasure-fence')
          if ((cursor && !validErasureFence(cursor.value)) || !equal(cursor ? cursor.value : null, pair[1]) || localStorage.getItem(FENCE_KEY) !== pair[0]) return refuse()
          await tx.objectStore('meta').put(target, 'erasure-fence')
        }) // complete commit BEFORE LS; (L0,T) is a durable retry point
        await attest()
      }
      guard.assertCurrent()
      const currentLocal = localStorage.getItem(FENCE_KEY)
      if (currentLocal !== header.erasure.fence.initialLocal && currentLocal !== target) return refuse()
      if (currentLocal !== target) localStorage.setItem(FENCE_KEY, target)
      await attest(); await advance('fenced')
      await attest()
    }
    // Every retry rescans declared copies. Never delete a B row, whole DB/job,
    // unscoped reports, shared salt, or an owner-prefix neighbour such as a-b.
    for (const copy of copies) for (const store of RAW_STORES) {
      const db = store === 'files' ? copy.files : copy.projects
      await scanRawStore(db, store, guard.assertCurrent, guard.signal, async rows => {
        const own = rows.filter(row => erasureRowOwner(store, row, header!.erasure) === header!.erasure.owner)
        if (!own.length) return
        if (!equal(await control(guard), header)) return refuse()
        await transaction(db, [store], 'readwrite', guard, async tx => {
          for (const row of own) {
            if (!equal(await tx.objectStore(store).get(row.key), row.value)) return refuse()
            guard.assertCurrent(); await tx.objectStore(store).delete(row.key)
          }
        })
      })
    }
    const oldPlan = await readPlan(job, header.generation, guard), redacted = projectErasurePlan(oldPlan, header.generation, header.erasure.owner)
    if (await digestRaw(redacted) !== header.erasure.proof.planHash) return refuse()
    await transaction(job, ['journal'], 'readwrite', guard, async tx => {
      if (!equal(await tx.objectStore('journal').get('plan'), oldPlan)) return refuse()
      await tx.objectStore('journal').put(redacted, 'plan')
    })
    const local = await erasureLocalSnapshot(header.generation, header.erasure.owner, header.version)
    if (local.hash !== header.erasure.proof.localHash || !equal(local.pairs, localPairs())) return refuse()
    for (const [key, value] of local.changes) { guard.assertCurrent(); if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }
    await attest(true)
    if (header.erasure.phase === 'reserved' || header.erasure.phase === 'fenced') await advance('local')
    // A new native process needs its own sticky fence, including after a crash
    // after the previous clear: call on EVERY resume, not only phase=local.
    guard.assertCurrent(); await clearColdMailScope(header.erasure.owner, header.version === 6 ? header.erasure.reset : undefined); guard.assertCurrent()
    if (header.erasure.phase === 'local') await advance('native')
    await attest(true)
    if (header.erasure.phase === 'native') await advance('verified')
    if (header.erasure.phase !== 'verified') return refuse()
    const reset: ResetRecord | undefined = header.version === 6 ? { owner: header.erasure.owner, operationId: header.erasure.operationId,
      resetId: header.erasure.reset.resetId, phase: 'available' } : undefined
    const final = { format: 'arty-workspace-control', version: reset ? 7 : 2, layout: 'isolated-v1', state: 'ready',
      revision: header.revision + 1, generation: header.generation, requiredOwners: header.requiredOwners,
      ...(header.version === 6 ? { resets: [...header.resets, reset!] } : {}) }
    if (header.version === 6 && !parseResetReadyControl(final)) return refuse()
    const finalSnapshot = await erasureLocalSnapshot(header.generation, header.erasure.owner, header.version)
    if (finalSnapshot.changes.length || finalSnapshot.hash !== header.erasure.proof.localHash) return refuse()
    await attestFences(copies[1]!.projects, header, guard)
    const finalLocal = finalSnapshot.pairs
    remember(final)
    bind({ control: final }, layout.generation, true)
    await cas(header, final, guard, () => {
      if (!equal(finalLocal, localPairs()) || (header!.version !== 4 && localStorage.getItem(FENCE_KEY) !== header!.erasure.fence.target)) refuse()
    })
    return isolatedWorkspaceLayout(header.generation, header.requiredOwners)
  } finally { opened.forEach(db => db.close()) }
}
