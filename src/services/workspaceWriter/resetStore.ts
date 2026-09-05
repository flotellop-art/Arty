import { openExistingDB } from '../readOnlyExistingDB'
import { assertDocumentWorkspace, documentWorkspaceSignal, getDocumentStorageLayout } from './runtime'
import { CONTROL_SHAPE, assertDatabaseShape } from './schema'
import { validateWorkspaceControl, WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY } from './control'
import { parseResetReadyControl, validResetRecords, type ResetReadyControl } from './resetProtocol'
import type { ResetRecord } from './resetProtocol'
import { equalErasure } from './erasureInventory'
import { getActiveUserId, getActiveSessionEpoch, getSessionProjectFence, PROJECT_ERASURE_FENCE_KEY } from '../userSession'
import { captureOwnerErasureGuard } from '../projects/localErasureGuard'

const refuse = (): never => { throw new Error('workspace_reset_unverifiable') }
/** Only the document owner writes. No new DB, no second metadata record and no
 * generic setReady. Each transition CASes the complete, strict current record. */
async function access(assert: () => void, expected?: ResetReadyControl, next?: ResetReadyControl, beforePut?: () => void): Promise<unknown> {
  const retired = new AbortController(), stop = () => retired.abort()
  const guard = () => { assertDocumentWorkspace(); assert(); if (retired.signal.aborted || documentWorkspaceSignal.aborted) refuse() }
  const timer = setTimeout(stop, 8_000)
  documentWorkspaceSignal.addEventListener('abort', stop, { once: true })
  let rejectStop!: (reason: Error) => void
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject })
  const reject = () => rejectStop(new Error('workspace_reset_cancelled'))
  retired.signal.addEventListener('abort', reject, { once: true })
  const work = async () => {
    guard()
    const db = await openExistingDB(WORKSPACE_CONTROL_DB, 1, guard, retired.signal)
    try {
      guard(); if (!db) return refuse()
      const tx = db.transaction(['meta'], next ? 'readwrite' : 'readonly')
      const abort = () => { try { tx.abort() } catch { /* settled */ } }
      retired.signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
      try {
        assertDatabaseShape(db, CONTROL_SHAPE, tx)
        const store = tx.objectStore('meta')
        if (await store.count() !== 1) return refuse()
        const raw = await store.get(WORKSPACE_CONTROL_KEY)
        const layout = validateWorkspaceControl(raw), current = getDocumentStorageLayout()
        if (layout.kind !== 'isolated-v1' || current.kind !== 'isolated-v1' || layout.generation !== current.generation ||
          !equalErasure(layout.requiredOwners, current.requiredOwners)) return refuse()
        guard()
        if (next) {
          if (!expected || !parseResetReadyControl(expected) || !parseResetReadyControl(next) || !equalErasure(raw, expected) ||
            next.revision !== expected.revision + 1 || next.generation !== expected.generation || !equalErasure(next.requiredOwners, expected.requiredOwners)) return refuse()
          guard(); beforePut!(); await store.put!(next, WORKSPACE_CONTROL_KEY)
        }
        await tx.done; guard(); return raw
      } catch (error) { abort(); await tx.done.catch(() => {}); throw error }
      finally { retired.signal.removeEventListener('abort', abort) }
    } finally { db?.close() }
  }
  try { return await Promise.race([work(), stopped]) }
  finally { clearTimeout(timer); documentWorkspaceSignal.removeEventListener('abort', stop); retired.signal.removeEventListener('abort', reject); retired.abort() }
}
export async function readResetControl(assert: () => void): Promise<ResetReadyControl | null> {
  return parseResetReadyControl(await access(assert)) // valid old v2 has no rights
}
export async function advanceResetControl(expected: ResetReadyControl, value: ResetRecord, assert: () => void, beforePut: () => void): Promise<ResetReadyControl> {
  // Clone before the first await; caller-owned objects cannot mutate a proof.
  assertDocumentWorkspace()
  const layout = getDocumentStorageLayout(), epoch = getActiveSessionEpoch(), fence = getSessionProjectFence()
  const snapshot = parseResetReadyControl(expected), owner = getActiveUserId(), erasure = captureOwnerErasureGuard(owner)
  if (!snapshot || !validResetRecords([value], snapshot.requiredOwners)) return refuse()
  const nextRecord = structuredClone(value)
  const prior = snapshot?.resets.find(r => r.owner === owner)
  if (!snapshot || !prior || nextRecord.owner !== owner || nextRecord.resetId !== prior.resetId || nextRecord.operationId !== prior.operationId ||
    !((prior.phase === 'available' && nextRecord.phase === 'provisioning') || (prior.phase === 'provisioning' && nextRecord.phase === 'consumed'))) return refuse()
  const next: ResetReadyControl = { ...snapshot, revision: snapshot.revision + 1, resets: snapshot.resets.map(r => r.owner === owner ? nextRecord : r) }
  if (!parseResetReadyControl(next)) return refuse()
  const guard = () => {
    assertDocumentWorkspace(); assert(); erasure()
    if (getActiveUserId() !== owner || getActiveSessionEpoch() !== epoch || layout !== getDocumentStorageLayout() ||
      fence === null || fence !== (localStorage.getItem(PROJECT_ERASURE_FENCE_KEY) ?? 'initial')) refuse()
  }
  await access(guard, snapshot, next, beforePut)
  return next
}
