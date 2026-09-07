import { parseAccountErasureRecord } from '../accountErasureJournal'
import type { IDBPTransaction } from 'idb'
import { assertNativeErasureOwner } from '../native/coldMailErasure'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY } from './control'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE, MIGRATION_JOURNAL_SHAPE } from './schema'
import { isolatedWorkspaceLayout } from './layout'
import { migrationDatabaseName } from './migrationProtocol'
import { parseErasureHeader, validErasureFence, type ErasureHeader } from './erasureProtocol'
import { readErasureProof } from './erasure'
import { localPairs } from './migrationInventory'
import { syncApplyJobKey, parseSyncApplyHeader } from './syncApplyProtocol'
import { workspaceAdmission, documentWorkspace } from './runtime'
import { parseSyncApplyPayload } from './syncApplyJournal'
import { openRestoreDatabases, restoreTransaction as transact, restoreEqual as equal, restoreFail as fail, type RestoreGuard } from './restoreJournal'

/** Explicit UI-confirmed LOCAL erasure of the job owner, not a server receipt.
 * No ready gap: replace root10+job with v6 in ONE control transaction, then a
 * new document runs the existing owner erasure. All B proofs describe CURRENT
 * data; no baseline, account key, old usage or old fence is reinstalled. */
export async function reserveSyncApplyErasure(external: RestoreGuard) {
  const initial = parseSyncApplyHeader(workspaceAdmission.getSyncApplyRecovery()) ?? fail('unavailable')
  const guard: RestoreGuard = { signal: external.signal, assertCurrent() {
    documentWorkspace.assertHeld(); external.assertCurrent()
    if (workspaceAdmission.getSnapshot() !== 'maintenance' || !equal(workspaceAdmission.getSyncApplyRecovery(), initial)) return fail('unavailable')
  } }
  guard.assertCurrent()
  assertNativeErasureOwner(initial.apply.owner)
  const layout = isolatedWorkspaceLayout(initial.generation, initial.requiredOwners, 2)
  const dbs = await openRestoreDatabases([
    { descriptor: { name: WORKSPACE_CONTROL_DB, version: 1 }, shape: CONTROL_SHAPE },
    { descriptor: { name: 'arty-files', version: 2 }, shape: FILE_SHAPE },
    { descriptor: { name: 'arty-projects', version: 2 }, shape: PROJECT_SHAPE },
    { descriptor: layout.files, shape: FILE_SHAPE }, { descriptor: layout.projects, shape: PROJECT_SHAPE },
    { descriptor: { name: migrationDatabaseName(layout.generation), version: 1 }, shape: MIGRATION_JOURNAL_SHAPE },
  ], guard)
  const [control, legacyFiles, legacyProjects, files, projects, job] = dbs as [typeof dbs[number], typeof dbs[number], typeof dbs[number], typeof dbs[number], typeof dbs[number], typeof dbs[number]]
  try {
    const key = syncApplyJobKey(initial.apply.id)
    const raw = await transact(control, ['meta'], 'readonly', guard, async tx => {
      const store = tx.objectStore('meta')
      if (await store.count() !== 2 || !equal(await store.get(WORKSPACE_CONTROL_KEY), initial)) return fail()
      return store.get(key)
    })
    await parseSyncApplyPayload(raw, initial, guard)
    const readActiveAuthority = async (tx: IDBPTransaction<unknown, string[], 'readonly'>) => {
      const receipt = await tx.objectStore('meta').openCursor(['erasing', initial.apply.owner])
      const fence = await tx.objectStore('meta').openCursor('erasure-fence')
      // Presence is part of the witness. A present undefined/null value is
      // corrupt, never interchangeable with an absent receipt/fence.
      if (receipt && !parseAccountErasureRecord(receipt.value) || fence && !validErasureFence(fence.value)) return fail('format')
      return { receipt: receipt ? { value: receipt.value } : null, fence: fence ? { value: fence.value as string } : null }
    }
    const activeBefore = await transact(projects, ['meta'], 'readonly', guard, readActiveAuthority)
    const old = activeBefore.receipt?.value
    const receipt = old === undefined ? { owner: initial.apply.owner, operationId: crypto.randomUUID(), nonce: crypto.randomUUID(), serverConfirmed: false, pending: [], localOnly: true as const }
      : parseAccountErasureRecord(old) ?? fail('format')
    // An existing unrelated or remote-uncertain intent needs its own recovery,
    // not a manufactured local replacement hidden in this journal transition.
    if (receipt.owner !== initial.apply.owner || !receipt.localOnly && !receipt.serverConfirmed) return fail('unavailable')
    const local = localPairs(), localFence = localStorage.getItem('arty-project-erasure-fence')
    const activeFence = activeBefore.fence?.value ?? null
    if (localFence !== null && !validErasureFence(localFence) || activeFence !== null && !validErasureFence(activeFence)) return fail('format')
    const target = crypto.randomUUID(), resetId = crypto.randomUUID()
    if (target === localFence || target === activeFence) return fail('format')
    const prior = initial.base.version === 7 ? initial.base.resets : [], ownReset = prior.find(r => r.owner === initial.apply.owner)
    if (ownReset && ownReset.phase !== 'consumed' || prior.some(r => r.resetId === resetId)) return fail('format')
    const candidate: ErasureHeader = { format: 'arty-workspace-control', version: 6, layout: 'isolated-v1', state: 'erasing', projectsVersion: 2,
      generation: initial.generation, requiredOwners: [...new Set([...initial.requiredOwners, initial.apply.owner])], revision: initial.revision + 1,
      resets: prior.filter(r => r.owner !== initial.apply.owner), erasure: { owner: receipt.owner, operationId: receipt.operationId, nonce: receipt.nonce,
        authority: receipt, phase: 'reserved', fence: { initialLocal: localFence, initialActive: activeFence, target },
        reset: { resetId, previousResetId: ownReset?.resetId ?? null }, proof: undefined! } }
    const copies = [{ copy: 'legacy' as const, files: legacyFiles, projects: legacyProjects }, { copy: 'active' as const, files, projects }, { copy: 'journal' as const, files: job, projects: job }]
    const attempt = { ...guard, assertLock: guard.assertCurrent }
    candidate.erasure.proof = (await readErasureProof(copies, job, candidate, attempt)).value
    const header = parseErasureHeader(candidate) ?? fail('format')
    if (!equal((await readErasureProof(copies, job, header, attempt)).value, header.erasure.proof) || !equal(localPairs(), local)) return fail()
    await transact(control, ['meta'], 'readwrite', guard, async tx => {
      const store = tx.objectStore('meta')
      // Re-read active authority AFTER entering this control RW. Keep that
      // transaction alive using reads until the other DB's proof is settled.
      // This is still a cooperative document-lock protocol, NOT cross-DB ACID.
      let settled = false
      const active = transact(projects, ['meta'], 'readonly', guard, async evidence => {
        if (!equal(await readActiveAuthority(evidence), activeBefore)) return fail()
      })
      void active.then(() => { settled = true }, () => { settled = true })
      // A keepalive read is NOT progress: do not renew the actor's inactivity
      // timer. Its abort signal cancels both transactions if evidence stalls.
      while (!settled) await store.count()
      await active
      if (await store.count() !== 2 || !equal(await store.get(WORKSPACE_CONTROL_KEY), initial) || await store.get(key) !== raw || !equal(localPairs(), local)) return fail()
      await store.delete(key)
      if (!equal(localPairs(), local)) return fail()
      await store.put(header, WORKSPACE_CONTROL_KEY)
    })
  } finally { dbs.forEach(db => db.close()) }
}
