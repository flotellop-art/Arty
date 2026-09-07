import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { workspaceAdmission } from './runtime'
import { ISOLATED_WORKSPACE_ENABLED } from './activation'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY } from './control'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE } from './schema'
import { isolatedWorkspaceLayout } from './layout'
import { digestRaw } from './migrationInventory'
import { parseSyncApplyHeader, syncApplyJobKey, syncApplyCompletedBase, type SyncApplyHeader } from './syncApplyProtocol'
import { parseSyncApplyPayload, syncApplyStoreProof, type SyncApplyPayload } from './syncApplyJournal'
import { openRestoreDatabase, restoreTransaction as transact, restoreEqual as equal, restoreFail as fail, restoreLocalSnapshot,
  assertRestoreLocal, proveRestoreSlots, restoreHistoryKeys, deriveRestoreUsage, zeroRestoreUsage, type RestoreGuard } from './restoreJournal'

/** Cold, already-adopted first materialization. The actor cannot accept a DTO,
 * authenticate, fetch or allocate data identities. Every attempt is terminal;
 * success, failure and uncertain commits all require a fresh document. */
export function createColdWorkspaceSyncApply() {
  if (!ISOLATED_WORKSPACE_ENABLED) return fail('unavailable')
  const initial = parseSyncApplyHeader(workspaceAdmission.getSyncApplyRecovery()) ?? fail('unavailable')
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
      return await Promise.race([action === 'erase-local'
        ? import('./syncApplyErasure').then(m => m.reserveSyncApplyErasure(guard))
        : publish(initial, action, guard), stopped])
    } finally { stop(); clearTimeout(timer); cold.signal.removeEventListener('abort', stop); aborter.signal.removeEventListener('abort', cancelled) }
  }
  return Object.freeze({ resume: () => run('resume'), abort: () => run('abort'), eraseLocal: () => run('erase-local') })
}

async function publish(initial: SyncApplyHeader, action: 'resume' | 'abort', guard: RestoreGuard) {
  const control = await openRestoreDatabase({ name: WORKSPACE_CONTROL_DB, version: 1 }, CONTROL_SHAPE, guard)
  let files: IDBPDatabase | undefined, projects: IDBPDatabase | undefined
  try {
    let header = initial
    const jobKey = syncApplyJobKey(initial.apply.id)
    const raw = await transact(control, ['meta'], 'readonly', guard, async tx => {
      const store = tx.objectStore('meta')
      if (await store.count() !== 2 || !equal(await store.get(WORKSPACE_CONTROL_KEY), initial)) return fail()
      return store.get(jobKey)
    })
    const p = await parseSyncApplyPayload(raw, initial, guard), layout = isolatedWorkspaceLayout(p.generation, header.requiredOwners, 2)
    files = await openRestoreDatabase(layout.files, FILE_SHAPE, guard)
    projects = await openRestoreDatabase(layout.projects, PROJECT_SHAPE, guard)
    const assertControl = async (tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>) => {
      const store = tx.objectStore('meta')
      if (await store.count() !== 2 || !equal(await store.get(WORKSPACE_CONTROL_KEY), header) || await store.get(jobKey) !== raw) return fail()
      guard.assertCurrent()
    }
    const checkpoint = async (phase: SyncApplyHeader['apply']['phase'], local: ReturnType<typeof restoreLocalSnapshot>) => {
      const next: SyncApplyHeader = { ...header, apply: { ...header.apply, phase } }
      await transact(control, ['meta'], 'readwrite', guard, async tx => {
        await assertControl(tx); assertRestoreLocal(local, guard); await tx.objectStore('meta').put(next, WORKSPACE_CONTROL_KEY)
      })
      header = next
    }
    async function historyState() {
      const local = restoreLocalSnapshot(p), proof = await proveRestoreSlots(local.history)
      const before = equal(proof, p.baseline.history)
      const candidate = p.historyCipher !== null && local.history[1] === p.historyCipher &&
        (equal(proof[0], p.baseline.history[0]) || local.history[0] === null) && equal(proof.slice(2), p.baseline.history.slice(2))
      if (!before && !(header.apply.phase === 'publishing' && candidate)) return fail()
      assertRestoreLocal(local, guard)
      return { local, before, complete: p.historyCipher === null ? before : candidate && local.history[0] === null }
    }
    async function projectState(tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>): Promise<'before' | 'after'> {
      await assertFence(tx, p)
      const state = await tx.objectStore('meta').get(['sync-state', p.owner])
      const mode = equal(state, p.stateBefore) ? 'before' : equal(state, p.stateAfter) ? 'after' : fail()
      for (const [store, rows] of [['projects', p.projects], ['documents', p.documents]] as const) for (const row of rows) {
        const found = await tx.objectStore(store).get(row.key)
        if (mode === 'before' ? found !== undefined : !equal(found, row)) return fail()
      }
      const expected = mode === 'before' ? p.usageBefore : p.usageAfter
      if (!equal(await tx.objectStore('usage').get(p.owner) ?? null, expected) ||
        !equal(await deriveRestoreUsage(tx, p.owner), expected ?? zeroRestoreUsage(p.owner))) return fail()
      return mode
    }
    const projectStores = ['projects', 'documents', 'usage', 'meta']
    async function fileState(require: 'before' | 'after' | 'either') {
      await transact(files!, ['files'], 'readonly', guard, async tx => {
        for (const row of p.files) {
          const value = await tx.objectStore('files').get(row.fileId)
          if (require === 'before' ? value !== undefined : require === 'after' ? !equal(value, row) : value !== undefined && !equal(value, row)) return fail()
        }
      })
    }
    async function attest(mode: 'before' | 'either' | 'after' = 'either') {
      const h = await historyState()
      if (await digestRaw(h.local.other) !== p.baseline.localHash || (localStorage.getItem('arty-project-erasure-fence') ?? 'initial') !== p.fence) return fail()
      if (!equal(await syncApplyStoreProof(files!, projects!, p, guard), p.baseline.stores)) return fail()
      const state = await transact(projects!, projectStores, 'readonly', guard, projectState)
      if (mode !== 'either' && state !== mode || state === 'before' && !h.before) return fail()
      if (mode === 'after' && !h.complete || mode === 'before' && !h.before) return fail()
      await fileState(mode)
      await transact(control, ['meta'], 'readonly', guard, assertControl)
      assertRestoreLocal(h.local, guard); return h
    }
    const complete = async (local: ReturnType<typeof restoreLocalSnapshot>) => transact(control, ['meta'], 'readwrite', guard, async tx => {
      await assertControl(tx); assertRestoreLocal(local, guard)
      await tx.objectStore('meta').delete(jobKey); assertRestoreLocal(local, guard)
      await tx.objectStore('meta').put(syncApplyCompletedBase(header), WORKSPACE_CONTROL_KEY)
    })
    if (action === 'abort') {
      if (header.apply.phase === 'prepared') {
        // A late warm writer may have invalidated the full baseline. No copy
        // can precede the cold copies checkpoint: abandon without reverting B.
        await fileState('before')
        await transact(projects, ['meta', 'projects', 'documents'], 'readonly', guard, async tx => {
          if (!equal(await tx.objectStore('meta').get(['sync-state', p.owner]), p.stateBefore)) return fail()
          for (const [store, rows] of [['projects', p.projects], ['documents', p.documents]] as const) for (const row of rows)
            if (await tx.objectStore(store).get(row.key) !== undefined) return fail()
        })
        await complete(restoreLocalSnapshot(p)); return
      }
      const h = await attest()
      if (!h.before) return fail('unavailable') // no general history rollback
      if (header.apply.phase !== 'aborting') await checkpoint('aborting', h.local)
      for (const row of p.files) await transact(files, ['files'], 'readwrite', guard, async tx => {
        const store = tx.objectStore('files'), current = await store.get(row.fileId); assertRestoreLocal(h.local, guard)
        if (current !== undefined) { if (!equal(current, row)) return fail(); await store.delete(row.fileId) }
      })
      await transact(projects, projectStores, 'readwrite', guard, async tx => {
        const mode = await projectState(tx); assertRestoreLocal(h.local, guard)
        if (mode === 'after') {
          for (const [store, rows] of [['documents', p.documents], ['projects', p.projects]] as const) for (const row of rows) await tx.objectStore(store).delete(row.key)
          if (!equal(await deriveRestoreUsage(tx, p.owner), p.usageBefore ?? zeroRestoreUsage(p.owner))) return fail()
          if (p.usageBefore === null) await tx.objectStore('usage').delete(p.owner)
          else await tx.objectStore('usage').put(p.usageBefore)
          // Explicit cold abandonment only. All candidate history is still
          // absent, so returning this exact sealed state is not a downgrade of
          // exposed provenance. Ordinary outbox CAS forbids this transition.
          await tx.objectStore('meta').put(p.stateBefore, ['sync-state', p.owner])
        }
        assertRestoreLocal(h.local, guard)
      })
      await complete((await attest('before')).local); return
    }
    if (header.apply.phase === 'aborting') return fail('unavailable')
    if (header.apply.phase === 'prepared') {
      // Essential: a queued ordinary writer could commit after warm review.
      // No target, including an exact candidate, is accepted before this gate.
      await checkpoint('copies', (await attest('before')).local)
    }
    const h = await attest()
    for (const row of p.files) {
      await transact(projects, ['meta'], 'readonly', guard, tx => assertFence(tx, p))
      await transact(files, ['files'], 'readwrite', guard, async tx => {
        const store = tx.objectStore('files'), current = await store.get(row.fileId); assertRestoreLocal(h.local, guard)
        if (current === undefined) await store.add(row)
        else if (!equal(current, row)) return fail()
      })
    }
    const beforeRecords = await attest()
    await transact(projects, projectStores, 'readwrite', guard, async tx => {
      const mode = await projectState(tx); assertRestoreLocal(beforeRecords.local, guard)
      if (mode === 'before') {
        for (const [store, rows] of [['projects', p.projects], ['documents', p.documents]] as const) for (const row of rows) await tx.objectStore(store).add(row)
        if (!equal(await deriveRestoreUsage(tx, p.owner), p.usageAfter)) return fail()
        await tx.objectStore('usage').put(p.usageAfter)
        await tx.objectStore('meta').put(p.stateAfter, ['sync-state', p.owner])
      }
      assertRestoreLocal(beforeRecords.local, guard)
    })
    if (header.apply.phase === 'copies') await checkpoint('publishing', (await attest()).local)
    const beforeHistory = await attest()
    if (p.historyCipher !== null) {
      const keys = restoreHistoryKeys(p)
      assertRestoreLocal(beforeHistory.local, guard)
      if (beforeHistory.local.history[1] !== p.historyCipher) localStorage.setItem(keys[1]!, p.historyCipher)
      const next = await attest(); assertRestoreLocal(next.local, guard)
      if (next.local.history[0] !== null) localStorage.removeItem(keys[0]!)
    }
    await complete((await attest('after')).local)
  } finally { control.close(); files?.close(); projects?.close() }
}
async function assertFence(tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>, p: SyncApplyPayload) {
  if ((await tx.objectStore('meta').get('erasure-fence') ?? 'initial') !== p.fence || await tx.objectStore('meta').get(['erasing', p.owner]) !== undefined) return fail()
}
