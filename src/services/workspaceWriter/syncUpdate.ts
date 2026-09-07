import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { workspaceAdmission } from './runtime'
import { ISOLATED_WORKSPACE_ENABLED } from './activation'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY } from './control'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE } from './schema'
import { isolatedWorkspaceLayout } from './layout'
import { digestRaw } from './migrationInventory'
import { parseSyncUpdateHeader, syncUpdateJobKey, syncUpdateCompletedBase, type SyncUpdateHeader } from './syncUpdateProtocol'
import { parseSyncUpdatePayload, syncUpdateStoreProof, assertSyncUpdateRows } from './syncUpdateJournal'
import { openRestoreDatabase, restoreTransaction as transact, restoreEqual as equal, restoreFail as fail, restoreLocalSnapshot,
  assertRestoreLocal, proveRestoreSlots, restoreHistoryKeys, type RestoreGuard } from './restoreJournal'

/** Cold v11 has no account/vault key and no network or UUID allocation. It
 * publishes the owned journal forwards, never restores/deletes old targets. */
export function createColdWorkspaceSyncUpdate() {
  if (!ISOLATED_WORKSPACE_ENABLED) return fail('unavailable')
  const initial = parseSyncUpdateHeader(workspaceAdmission.getSyncApplyRecovery()) ?? fail('unavailable')
  const cold = workspaceAdmission.claimMaintenance()
  let chosen = false
  async function run(action: 'resume' | 'abort' | 'erase-local') {
    if (chosen) return fail()
    chosen = true
    const aborter = new AbortController(), stop = () => aborter.abort()
    cold.signal.addEventListener('abort', stop, { once: true })
    let timer = setTimeout(stop, 120_000)
    const guard: RestoreGuard = { signal: aborter.signal, assertCurrent() {
      cold.assertLock()
      if (!ISOLATED_WORKSPACE_ENABLED || cold.signal.aborted || aborter.signal.aborted) return fail('cancelled')
      clearTimeout(timer); timer = setTimeout(stop, 120_000)
    } }
    let reject!: (error: Error) => void
    const stopped = new Promise<never>((_resolve, no) => { reject = no })
    const cancelled = () => { try { fail('cancelled') } catch (e) { reject(e as Error) } }
    aborter.signal.addEventListener('abort', cancelled, { once: true })
    try {
      return await Promise.race([action === 'erase-local' ? import('./syncApplyErasure').then(m => m.reserveSyncApplyErasure(guard)) : publish(initial, action, guard), stopped])
    } finally { stop(); clearTimeout(timer); cold.signal.removeEventListener('abort', stop); aborter.signal.removeEventListener('abort', cancelled) }
  }
  return Object.freeze({ resume: () => run('resume'), abort: () => run('abort'), eraseLocal: () => run('erase-local') })
}
async function publish(initial: SyncUpdateHeader, action: 'resume' | 'abort', guard: RestoreGuard) {
  const control = await openRestoreDatabase({ name: WORKSPACE_CONTROL_DB, version: 1 }, CONTROL_SHAPE, guard)
  let files: IDBPDatabase | undefined, projects: IDBPDatabase | undefined
  try {
    let header = initial
    const key = syncUpdateJobKey(initial.apply.id)
    const raw = await transact(control, ['meta'], 'readonly', guard, async tx => {
      const store = tx.objectStore('meta')
      if (await store.count() !== 2 || !equal(await store.get(WORKSPACE_CONTROL_KEY), initial)) return fail()
      return store.get(key)
    })
    const p = await parseSyncUpdatePayload(raw, initial, guard), layout = isolatedWorkspaceLayout(p.generation, header.requiredOwners, 2)
    const assertControl = async (tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>) => {
      const store = tx.objectStore('meta')
      if (await store.count() !== 2 || !equal(await store.get(WORKSPACE_CONTROL_KEY), header) || await store.get(key) !== raw) return fail()
      guard.assertCurrent()
    }
    const complete = async (local: ReturnType<typeof restoreLocalSnapshot>) => transact(control, ['meta'], 'readwrite', guard, async tx => {
      await assertControl(tx); assertRestoreLocal(local, guard)
      await tx.objectStore('meta').delete(key); assertRestoreLocal(local, guard)
      await tx.objectStore('meta').put(syncUpdateCompletedBase(header), WORKSPACE_CONTROL_KEY)
      assertRestoreLocal(local, guard)
    })
    if (action === 'abort' && header.apply.phase === 'prepared') {
      // No v11 business write can precede publishing. Late ordinary writes may
      // invalidate BEFORE; discarding only this journal preserves actual B.
      await complete(restoreLocalSnapshot(p)); return
    }
    files = await openRestoreDatabase(layout.files, FILE_SHAPE, guard)
    projects = await openRestoreDatabase(layout.projects, PROJECT_SHAPE, guard)
    async function historyState() {
      const local = restoreLocalSnapshot(p), proof = await proveRestoreSlots(local.history)
      const before = equal(proof, p.baseline.history)
      const candidate = p.historyCipher !== null && local.history[1] === p.historyCipher &&
        (equal(proof[0], p.baseline.history[0]) || local.history[0] === null) && equal(proof.slice(2), p.baseline.history.slice(2))
      if (!before && !(header.apply.phase === 'publishing' && candidate)) return fail()
      assertRestoreLocal(local, guard)
      return { local, before, complete: p.historyCipher === null ? before : candidate && local.history[0] === null }
    }
    async function attest(require?: 'before' | 'after') {
      const h = await historyState()
      if (await digestRaw(h.local.other) !== p.baseline.localHash || localStorage.getItem('arty-project-erasure-fence') !== p.localFence) return fail()
      if (!equal(await syncUpdateStoreProof(files!, projects!, p, guard), p.baseline.stores)) return fail()
      const mode = await transact(projects!, ['meta', 'projects'], 'readonly', guard, tx => assertSyncUpdateRows(tx, p))
      // History-first order, including project-only updates with null cipher.
      if (mode === 'after' && !h.complete || header.apply.phase === 'prepared' && (mode !== 'before' || !h.before) ||
        require === 'before' && (mode !== 'before' || !h.before) || require === 'after' && (mode !== 'after' || !h.complete)) return fail()
      await transact(control, ['meta'], 'readonly', guard, assertControl)
      assertRestoreLocal(h.local, guard); return { ...h, mode }
    }
    if (action === 'abort') {
      const h = await attest('before')
      await complete(h.local); return
    }
    if (header.apply.phase === 'prepared') {
      const h = await attest('before'), next: SyncUpdateHeader = { ...header, apply: { ...header.apply, phase: 'publishing' } }
      await transact(control, ['meta'], 'readwrite', guard, async tx => {
        await assertControl(tx); assertRestoreLocal(h.local, guard)
        await tx.objectStore('meta').put(next, WORKSPACE_CONTROL_KEY); assertRestoreLocal(h.local, guard)
      })
      header = next
    }
    const h = await attest()
    if (p.historyCipher !== null && !h.complete) {
      const keys = restoreHistoryKeys(p)
      assertRestoreLocal(h.local, guard)
      if (h.local.history[1] !== p.historyCipher) localStorage.setItem(keys[1]!, p.historyCipher)
      const intermediate = await attest(); assertRestoreLocal(intermediate.local, guard)
      if (intermediate.local.history[0] !== null) localStorage.removeItem(keys[0]!)
    }
    const beforeRows = await attest()
    if (!beforeRows.complete) return fail()
    await transact(projects, ['meta', 'projects'], 'readwrite', guard, async tx => {
      const mode = await assertSyncUpdateRows(tx, p); assertRestoreLocal(beforeRows.local, guard)
      if (mode === 'before') {
        for (const pair of p.projects) { await tx.objectStore('projects').put(pair.after); assertRestoreLocal(beforeRows.local, guard) }
        await tx.objectStore('meta').put(p.stateAfter, ['sync-state', p.owner])
      }
      // Fence reattestation stays INSIDE the RW, including last request success.
      if (await assertSyncUpdateRows(tx, p) !== 'after') return fail()
      assertRestoreLocal(beforeRows.local, guard)
    })
    await complete((await attest('after')).local)
  } finally { control.close(); files?.close(); projects?.close() }
}
