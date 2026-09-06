import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { parseAccountErasureRecord } from '../accountErasureJournal'
import { workspaceAdmission } from './runtime'
import { ISOLATED_WORKSPACE_ENABLED } from './activation'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY } from './control'
import { restoreCompletedBase, parseRestoreHeader, restoreJobKey, type RestoreHeader } from './restoreProtocol'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE } from './schema'
import { isolatedWorkspaceLayout } from './layout'
import { digestRaw } from './migrationInventory'
import { assertRestoreLocal, deriveRestoreUsage, openRestoreDatabase, parseRestorePayload, proveRestoreSlots, restoreEqual, restoreFail,
  restoreHistoryKeys, restoreLocalSnapshot, restoreStoreProof, restoreTransaction, validRestoreUsage, zeroRestoreUsage,
  type RestoreGuard, type RestorePayload } from './restoreJournal'

/** One cold attempt, explicitly selected by the user. No app crypto, sessions,
 * file chooser, network, reset, or private App may be initialized in this actor.
 * The already-adopted ciphertexts are sufficient after a process interruption. */
export function createColdWorkspaceRestore() {
  if (!ISOLATED_WORKSPACE_ENABLED) return restoreFail('unavailable')
  const admitted = workspaceAdmission.getRestoreRecovery()
  if (!admitted) return restoreFail('unavailable')
  const initial = parseRestoreHeader(admitted) ?? restoreFail('format')
  const cold = workspaceAdmission.claimMaintenance()
  let chosen = false
  const run = async (action: 'resume' | 'abort') => {
    if (chosen) return restoreFail('changed')
    chosen = true // includes errors and uncertain commits: next attempt = reload
    cold.assertLock()
    const aborter = new AbortController(), stop = () => aborter.abort()
    cold.signal.addEventListener('abort', stop, { once: true })
    let timer = setTimeout(stop, 120_000)
    const guard: RestoreGuard = { signal: aborter.signal, assertCurrent() {
      cold.assertLock()
      if (cold.signal.aborted || aborter.signal.aborted || !ISOLATED_WORKSPACE_ENABLED) restoreFail('cancelled')
      clearTimeout(timer); timer = setTimeout(stop, 120_000)
    } }
    let reject!: (error: Error) => void
    const stopped = new Promise<never>((_resolve, no) => { reject = no })
    const cancelled = () => { try { restoreFail('cancelled') } catch (e) { reject(e as Error) } }
    aborter.signal.addEventListener('abort', cancelled, { once: true })
    try { return await Promise.race([publish(initial, action, guard), stopped]) }
    finally { stop(); clearTimeout(timer); cold.signal.removeEventListener('abort', stop); aborter.signal.removeEventListener('abort', cancelled) }
  }
  return Object.freeze({ resume: () => run('resume'), abort: () => run('abort') })
}

async function publish(initial: RestoreHeader, action: 'resume' | 'abort', guard: RestoreGuard): Promise<void> {
  const control = await openRestoreDatabase({ name: WORKSPACE_CONTROL_DB, version: 1 }, CONTROL_SHAPE, guard)
  let files: IDBPDatabase | undefined, projects: IDBPDatabase | undefined
  try {
    let header = initial
    const jobKey = restoreJobKey(initial.restore.id)
    const raw = await restoreTransaction(control, ['meta'], 'readonly', guard, async tx => {
      const store = tx.objectStore('meta')
      if (await store.count() !== 2 || !restoreEqual(await store.get(WORKSPACE_CONTROL_KEY), initial)) return restoreFail()
      return store.get(jobKey) as Promise<unknown>
    })
    const p = await parseRestorePayload(raw, initial, guard), layout = isolatedWorkspaceLayout(initial.generation, initial.requiredOwners)
    files = await openRestoreDatabase(layout.files, FILE_SHAPE, guard)
    projects = await openRestoreDatabase(layout.projects, PROJECT_SHAPE, guard)
    const assertControl = async (tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>) => {
      const store = tx.objectStore('meta')
      if (await store.count() !== 2 || !restoreEqual(await store.get(WORKSPACE_CONTROL_KEY), header) || await store.get(jobKey) !== raw) restoreFail()
      guard.assertCurrent()
    }
    const checkpoint = async (phase: RestoreHeader['restore']['phase'], local?: ReturnType<typeof restoreLocalSnapshot>) => {
      const next: RestoreHeader = { ...header, restore: { ...header.restore, phase } }
      await restoreTransaction(control, ['meta'], 'readwrite', guard, async tx => {
        await assertControl(tx)
        if (local) assertRestoreLocal(local, guard)
        await tx.objectStore('meta').put(next, WORKSPACE_CONTROL_KEY)
      })
      header = next
    }
    const expectedUsage = p.projects.length ? p.usageAfter : p.usageBefore
    const checkUsage = async (tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>, complete: boolean) => {
      const value = await tx.objectStore('usage').get(p.owner) ?? null
      const derived = await deriveRestoreUsage(tx, p.owner)
      if (!restoreEqual(derived, value ?? zeroRestoreUsage(p.owner)) ||
        !(restoreEqual(value, expectedUsage) || (!complete && restoreEqual(value, p.usageBefore)))) return restoreFail()
    }
    const attest = async (complete = false) => {
      const local = restoreLocalSnapshot(p)
      if (await digestRaw(local.other) !== p.baseline.localHash || (localStorage.getItem('arty-project-erasure-fence') ?? 'initial') !== p.fence) return restoreFail()
      const proof = await proveRestoreSlots(local.history), old = p.baseline.history
      const unchanged = restoreEqual(proof, old)
      // A publish checkpoint precedes the first history mutation. Recognize
      // cipher-written/plain-not-yet-removed, never old-cipher/plain-removed.
      const candidate = header.restore.phase === 'publishing' && p.historyCipher !== null && local.history[1] === p.historyCipher &&
        (restoreEqual(proof[0], old[0]) || local.history[0] === null) && restoreEqual(proof.slice(2), old.slice(2))
      if (!unchanged && !candidate) return restoreFail()
      if (complete && p.historyCipher !== null && !(candidate && local.history[0] === null)) return restoreFail()
      if (!restoreEqual(await restoreStoreProof(files!, projects!, p, guard), p.baseline.stores)) return restoreFail()
      await restoreTransaction(projects!, ['meta', 'projects', 'documents', 'usage'], 'readonly', guard, async tx => {
        await assertFence(tx, p); await checkUsage(tx, complete)
      })
      if (complete) await verifyCopies(files!, projects!, p, guard)
      await restoreTransaction(control, ['meta'], 'readonly', guard, assertControl)
      assertRestoreLocal(local, guard)
      return local
    }
    if (action === 'abort') {
      if (header.restore.phase === 'publishing') {
        // A permanent quota can refuse the FIRST history write. Under this
        // cold lock, an exact old four-slot witness proves no new history was
        // exposed. No such inference for null/unchanged-history archives.
        if (p.historyCipher === null) return restoreFail('unavailable')
        const local = await attest()
        if (!restoreEqual(await proveRestoreSlots(local.history), p.baseline.history) || local.history[1] === p.historyCipher) return restoreFail('unavailable')
        await checkpoint('aborting', local)
      }
      // This persisted direction is not inferred from source/history equality.
      // Crash after the first delete can ONLY continue abandonment next time.
      if (header.restore.phase === 'copies') await checkpoint('aborting')
      for (const row of p.files) {
        await restoreTransaction(files, ['files'], 'readwrite', guard, async tx => {
          const present = await tx.objectStore('files').get(row.fileId)
          if (present !== undefined) { if (!restoreEqual(present, row)) return restoreFail(); await tx.objectStore('files').delete(row.fileId) }
        })
      }
      await restoreTransaction(projects, ['projects', 'documents', 'usage', 'meta'], 'readwrite', guard, async tx => {
        const usage = await tx.objectStore('usage').get(p.owner), receipt = await tx.objectStore('meta').get(['erasing', p.owner])
        if (receipt !== undefined && parseAccountErasureRecord(receipt)?.owner !== p.owner) return restoreFail('format')
        const before = await deriveRestoreUsage(tx, p.owner)
        if (receipt === undefined && usage !== undefined && (!validRestoreUsage(usage, p.owner) || !restoreEqual(usage, before))) return restoreFail()
        for (const [store, rows] of [['documents', p.documents], ['projects', p.projects]] as const) for (const row of rows) {
          const present = await tx.objectStore(store).get(row.key)
          if (present !== undefined) { if (!restoreEqual(present, row)) return restoreFail(); await tx.objectStore(store).delete(row.key) }
        }
        const after = await deriveRestoreUsage(tx, p.owner)
        if (usage === undefined) {
          // A concurrent erasure may already have removed usage. Do not
          // resurrect it or an old owner's fence/session/key. Preserve receipt.
          if (receipt === undefined && !restoreEqual(after, zeroRestoreUsage(p.owner))) return restoreFail()
        } else if (p.usageBefore === null && restoreEqual(usage, p.usageAfter) && restoreEqual(after, zeroRestoreUsage(p.owner)) &&
          (await tx.objectStore('meta').get('erasure-fence') ?? 'initial') === p.fence) await tx.objectStore('usage').delete(p.owner)
        else await tx.objectStore('usage').put(after)
      })
      // No global baseline reinstallation: cancellation owns only these IDs.
      await verifyCopies(files, projects, p, guard, true)
      await restoreTransaction(control, ['meta'], 'readwrite', guard, async tx => {
        await assertControl(tx)
        await tx.objectStore('meta').delete(jobKey)
        await tx.objectStore('meta').put(restoreCompletedBase(header), WORKSPACE_CONTROL_KEY)
      })
      return
    }
    if (header.restore.phase === 'aborting') return restoreFail('unavailable')
    const copyLocal = await attest()
    for (const row of p.files) {
      // The lock excludes updated writers. Keep a synchronous LS witness and
      // a fresh durable fence between copies, not an O(files²) ciphertext scan.
      assertRestoreLocal(copyLocal, guard)
      await restoreTransaction(projects, ['meta'], 'readonly', guard, tx => assertFence(tx, p))
      await restoreTransaction(files, ['files'], 'readwrite', guard, async tx => {
        const present = await tx.objectStore('files').get(row.fileId)
        assertRestoreLocal(copyLocal, guard)
        if (present === undefined) await tx.objectStore('files').add(row)
        else if (!restoreEqual(present, row)) return restoreFail()
      })
    }
    const local = await attest()
    await restoreTransaction(projects, ['projects', 'documents', 'usage', 'meta'], 'readwrite', guard, async tx => {
      await assertFence(tx, p); await checkUsage(tx, false)
      // All project rows and their absolute usage commit together. A retry can
      // observe none or all, never an intermediate increment.
      let presentCount = 0
      for (const [store, rows] of [['projects', p.projects], ['documents', p.documents]] as const) for (const row of rows) {
        const present = await tx.objectStore(store).get(row.key)
        if (present !== undefined) { if (!restoreEqual(present, row)) return restoreFail(); presentCount++ }
      }
      if (presentCount !== 0 && presentCount !== p.projects.length + p.documents.length) return restoreFail()
      assertRestoreLocal(local, guard)
      if (!presentCount) {
        if (!restoreEqual(await tx.objectStore('usage').get(p.owner) ?? null, p.usageBefore)) return restoreFail()
        for (const [store, rows] of [['projects', p.projects], ['documents', p.documents]] as const) for (const row of rows) await tx.objectStore(store).add(row)
        if (p.projects.length) await tx.objectStore('usage').put(p.usageAfter)
      }
      await checkUsage(tx, true); assertRestoreLocal(local, guard)
    })
    await attest()
    if (header.restore.phase === 'copies') await checkpoint('publishing')
    let beforeHistory = await attest()
    if (p.historyCipher !== null) {
      const keys = restoreHistoryKeys(p)
      assertRestoreLocal(beforeHistory, guard)
      if (beforeHistory.history[1] !== p.historyCipher) localStorage.setItem(keys[1]!, p.historyCipher)
      beforeHistory = await attest()
      assertRestoreLocal(beforeHistory, guard)
      if (beforeHistory.history[0] !== null) localStorage.removeItem(keys[0]!)
    }
    const finalLocal = await attest(true)
    await restoreTransaction(control, ['meta'], 'readwrite', guard, async tx => {
      await assertControl(tx); assertRestoreLocal(finalLocal, guard)
      await tx.objectStore('meta').delete(jobKey)
      assertRestoreLocal(finalLocal, guard)
      await tx.objectStore('meta').put(restoreCompletedBase(header), WORKSPACE_CONTROL_KEY)
    })
  } finally { control.close(); files?.close(); projects?.close() }
}
async function assertFence(tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>, p: RestorePayload) {
  if ((await tx.objectStore('meta').get('erasure-fence') ?? 'initial') !== p.fence || await tx.objectStore('meta').get(['erasing', p.owner]) !== undefined) return restoreFail()
}
async function verifyCopies(files: IDBPDatabase, projects: IDBPDatabase, p: RestorePayload, guard: RestoreGuard, absent = false) {
  await restoreTransaction(files, ['files'], 'readonly', guard, async tx => {
    for (const row of p.files) {
      const present = await tx.objectStore('files').get(row.fileId)
      if (absent ? present !== undefined : !restoreEqual(present, row)) return restoreFail()
    }
  })
  await restoreTransaction(projects, ['projects', 'documents'], 'readonly', guard, async tx => {
    for (const [store, rows] of [['projects', p.projects], ['documents', p.documents]] as const) for (const row of rows) {
      const present = await tx.objectStore(store).get(row.key)
      if (absent ? present !== undefined : !restoreEqual(present, row)) return restoreFail()
    }
  })
}
