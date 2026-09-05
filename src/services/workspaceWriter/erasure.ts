import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { assertNativeErasureOwner, clearColdMailScope } from '../native/coldMailErasure'
import { ISOLATED_WORKSPACE_ENABLED } from './activation'
import { workspaceAdmission } from './runtime'
import { validateWorkspaceControl, WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY, type AdmissionGuard } from './control'
import { isolatedWorkspaceLayout } from './layout'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE, MIGRATION_JOURNAL_SHAPE, assertDatabaseShape, type StoreShape } from './schema'
import { migrationDatabaseName } from './migrationProtocol'
import { parseConfirmedCleanup, parseErasureHeader, type ErasureHeader, type ErasureProof, type ErasureStoreProof } from './erasureProtocol'
import { RAW_STORES, scanRawStore, digestRaw, digestText, localPairs } from './migrationInventory'
import { equalErasure as equal, refuseErasure as refuse, projectErasurePlan, erasureLocalSnapshot, erasureRowOwner } from './erasureInventory'

type Attempt = AdmissionGuard & { assertCurrent(): void }
type Copy = { copy: ErasureStoreProof['copy']; files: IDBPDatabase; projects: IDBPDatabase }
/** Only entry point: actual cold singleton + intrinsic OFF gate. No confirmation
 * parameter, HTTP, login, KDF, private App import or fresh-key authorization. */
export function createColdWorkspaceErasure() {
  if (!ISOLATED_WORKSPACE_ENABLED) throw new Error('workspace_erasure_disabled')
  const cold = workspaceAdmission.claimMaintenance()
  let busy = false, knownFinal: unknown
  return Object.freeze({ async resume() {
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
    try { return await Promise.race([erase(guard, knownFinal, v => { knownFinal = v }), stopped]) }
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
async function proof(copies: Copy[], job: IDBPDatabase, header: ErasureHeader, guard: Attempt): Promise<{ value: ErasureProof; absent: boolean }> {
  const local = await erasureLocalSnapshot(header.generation, header.erasure.owner)
  guard.assertCurrent()
  const plan = await readPlan(job, header.generation, guard), redacted = projectErasurePlan(plan, header.generation, header.erasure.owner)
  let absent = !local.changes.length && equal(plan, redacted)
  const stores: ErasureStoreProof[] = []
  for (const copy of copies) {
    let fence: string | undefined
    for (const store of RAW_STORES) {
      let hash = await digestText('arty-erasure-protected-store-v1'), count = 0
      await scanRawStore(store === 'files' ? copy.files : copy.projects, store, guard.assertCurrent, guard.signal, async rows => {
        for (const row of rows) {
          if (erasureRowOwner(store, row, header.erasure) === header.erasure.owner) absent = false
          else { hash = await digestText(JSON.stringify([hash, await digestRaw([row.key, row.value])])); count++ }
          if (store === 'meta' && row.key === 'erasure-fence') fence = row.value as string
          guard.assertCurrent()
        }
      })
      stores.push({ copy: copy.copy, store, hash, count })
    }
    if (copy.copy === 'active' && (fence ?? 'initial') !== (localStorage.getItem('arty-project-erasure-fence') ?? 'initial')) return refuse()
  }
  return { value: { localHash: local.hash, planHash: await digestRaw(redacted), stores }, absent }
}
async function erase(guard: Attempt, knownFinal: unknown, remember: (v: unknown) => void) {
  const initial = await control(guard)
  // Only an exact final record attempted by this actor can acknowledge a lost
  // commit response. No arbitrary v2 generation implies completed erasure.
  if (knownFinal && equal(initial, knownFinal)) return validateWorkspaceControl(initial)
  let header = parseErasureHeader(initial)
  const layout = header ? isolatedWorkspaceLayout(header.generation, header.requiredOwners) : validateWorkspaceControl(initial)
  if (layout.kind !== 'isolated-v1') return refuse()
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
      const receipts = await transaction(copies[1]!.projects, ['meta'], 'readonly', guard, async tx => {
        const found = []
        let cursor = await tx.objectStore('meta').openCursor()
        while (cursor) {
          guard.assertCurrent()
          if (Array.isArray(cursor.key) && cursor.key[0] === 'erasing') {
            const receipt = parseConfirmedCleanup(cursor.value)
            if (!receipt || cursor.key.length !== 2 || cursor.key[1] !== receipt.owner) return refuse()
            found.push(receipt)
          }
          cursor = await cursor.continue()
        }
        return found
      })
      if (receipts.length !== 1) return refuse()
      const receipt = receipts[0]!, requiredOwners = [...new Set([...layout.requiredOwners, receipt.owner])]
      isolatedWorkspaceLayout(layout.generation, requiredOwners) // bound before mutation
      assertNativeErasureOwner(receipt.owner)
      const candidate: ErasureHeader = { format: 'arty-workspace-control', version: 4, layout: 'isolated-v1', state: 'erasing',
        generation: layout.generation, revision: initial.revision + 1, requiredOwners,
        erasure: { owner: receipt.owner, operationId: receipt.operationId, nonce: receipt.nonce, phase: 'reserved', proof: undefined! } }
      candidate.erasure.proof = (await proof(copies, job, candidate, guard)).value
      header = parseErasureHeader(candidate)
      if (!header) return refuse()
      await cas(initial, header, guard)
    }
    assertNativeErasureOwner(header.erasure.owner)
    const attest = async (requireAbsent = false) => {
      if (!equal(await control(guard), header)) return refuse()
      const current = await proof(copies, job, header!, guard)
      if (!equal(current.value, header!.erasure.proof) || (requireAbsent && !current.absent)) return refuse()
    }
    const advance = async (phase: ErasureHeader['erasure']['phase']) => {
      const next = parseErasureHeader({ ...header, revision: header!.revision + 1, erasure: { ...header!.erasure, phase } })
      if (!next) return refuse()
      await cas(header, next, guard); header = next
    }
    await attest()
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
    const local = await erasureLocalSnapshot(header.generation, header.erasure.owner)
    if (local.hash !== header.erasure.proof.localHash || !equal(local.pairs, localPairs())) return refuse()
    for (const [key, value] of local.changes) { guard.assertCurrent(); if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }
    await attest(true)
    if (header.erasure.phase === 'reserved') await advance('local')
    // A new native process needs its own sticky fence, including after a crash
    // after the previous clear: call on EVERY resume, not only phase=local.
    guard.assertCurrent(); await clearColdMailScope(header.erasure.owner); guard.assertCurrent()
    if (header.erasure.phase === 'local') await advance('native')
    await attest(true)
    if (header.erasure.phase === 'native') await advance('verified')
    if (header.erasure.phase !== 'verified') return refuse()
    const final = { format: 'arty-workspace-control', version: 2, layout: 'isolated-v1', state: 'ready',
      revision: header.revision + 1, generation: header.generation, requiredOwners: header.requiredOwners }
    const finalSnapshot = await erasureLocalSnapshot(header.generation, header.erasure.owner)
    if (finalSnapshot.changes.length || finalSnapshot.hash !== header.erasure.proof.localHash) return refuse()
    const finalLocal = finalSnapshot.pairs
    remember(final)
    await cas(header, final, guard, () => { if (!equal(finalLocal, localPairs())) refuse() })
    return isolatedWorkspaceLayout(header.generation, header.requiredOwners)
  } finally { opened.forEach(db => db.close()) }
}
