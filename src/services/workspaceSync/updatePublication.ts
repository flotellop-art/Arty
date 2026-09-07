import type { Conversation } from '../../types'
import { captureLocalReadScope } from '../projects/store'
import { validProject } from '../projects/types'
import { decodeProjectSnapshot } from '../projects/snapshotDecoding'
import { captureHistoryForSyncCoverage } from '../storage'
import { encrypt, decrypt } from '../crypto'
import { hasActiveConversationWork } from '../conversationWork'
import { isNative } from '../native/platform'
import { documentWorkspace, documentWorkspaceSignal, getDocumentStorageLayout } from '../workspaceWriter/runtime'
import { ISOLATED_WORKSPACE_ENABLED } from '../workspaceWriter/activation'
import { WORKSPACE_SYNC_APPLY_START_ENABLED } from './activation'
import { captureLocalSyncQuiescence } from '../workspaceWriter/localSyncActivity'
import { WORKSPACE_CONTROL_DB, WORKSPACE_CONTROL_KEY } from '../workspaceWriter/control'
import { CONTROL_SHAPE, FILE_SHAPE, PROJECT_SHAPE } from '../workspaceWriter/schema'
import { parseRestoreReady } from '../workspaceWriter/restoreProtocol'
import { controlProjectsVersion } from '../workspaceWriter/layout'
import { SYNC_APPLY_BYTES } from '../workspaceWriter/syncApplyProtocol'
import { parseSyncUpdateHeader, syncUpdateJobKey, type SyncUpdateHeader } from '../workspaceWriter/syncUpdateProtocol'
import { parseSyncUpdatePayload, syncUpdateStoreProof, readSyncUpdateFence, assertSyncUpdateRows, type SyncUpdatePayload } from '../workspaceWriter/syncUpdateJournal'
import { restoreEqual as equal, restoreFail as fail, openRestoreDatabases, restoreTransaction as transact, restoreLocalSnapshot,
  assertRestoreLocal, proveRestoreSlots, type RestoreProject } from '../workspaceWriter/restoreJournal'
import { digestRaw, digestText } from '../workspaceWriter/migrationInventory'
import { planExistingSyncUpdate } from './existingUpdatePlan'
import { attestMaterializedTargets } from './materializedCoverage'
import { canonicalSyncJSON } from './captureContent'
import { createSyncIdentityInventory } from './occupiedIdentities'
import type { prepareFirstSyncApply } from './applyPublication'
import type { SyncManifest } from './types'
import type { SyncLocalBinding } from './privateState'

/** Internal receipt-owned preparation. UI cannot choose owners, ciphertexts,
 * addresses or a baseline. Hold coverage and full BEFORE until adoption. */
export async function prepareExistingSyncUpdate(args: Parameters<typeof prepareFirstSyncApply>[0] & {
  materialized: SyncManifest; bindings: SyncLocalBinding[]
}) {
  if (!ISOLATED_WORKSPACE_ENABLED || !WORKSPACE_SYNC_APPLY_START_ENABLED || isNative) return fail('unavailable')
  args.authority.assertCurrent(); args.receipt.assertCurrent(); args.reviewed.assertCurrent()
  const scope = captureLocalReadScope(args.authority.signal), layout = getDocumentStorageLayout()
  if (layout.kind !== 'isolated-v1' || layout.projects.version !== 2 || scope.owner === 'anon') return fail('unavailable')
  const admitRead = () => {
    if (!WORKSPACE_SYNC_APPLY_START_ENABLED) return fail('unavailable')
    args.authority.assertCurrent(); args.receipt.assertCurrent(); args.reviewed.assertCurrent(); scope.assertCurrent()
  }
  // Reject a replaced durable pair/fence before capturing or decrypting private
  // history. Recheck live authority after EACH asynchronous admission step.
  await scope.validateReadOnly(); admitRead()
  await args.authority.validateReadOnly(); admitRead()
  const history = captureHistoryForSyncCoverage(), syncQuiet = captureLocalSyncQuiescence(), capturedDocument = documentWorkspace
  const stateBefore = structuredClone(args.stateBefore)
  if (![1, 2].includes(stateBefore.version) || stateBefore.owner !== scope.owner || stateBefore.generation !== layout.generation || stateBefore.pending) return fail('format')
  let disposed = false, attempted = false, raw: string | undefined
  let coverage: Awaited<ReturnType<typeof attestMaterializedTargets>> | undefined
  const lifetime = new AbortController(), signals = [documentWorkspaceSignal, args.receipt.signal, args.authority.signal]
  const dispose = () => { disposed = true; raw = undefined; coverage?.dispose(); lifetime.abort(); for (const s of signals) s?.removeEventListener('abort', dispose) }
  for (const signal of signals) signal?.addEventListener('abort', dispose, { once: true })
  if (signals.some(signal => signal?.aborted)) dispose()
  const guard = { signal: lifetime.signal, assertCurrent() {
    if (disposed || lifetime.signal.aborted) return fail('cancelled')
    if (!WORKSPACE_SYNC_APPLY_START_ENABLED) return fail('unavailable')
    args.authority.assertCurrent(); args.receipt.assertCurrent(); args.reviewed.assertCurrent()
    scope.assertCurrent(); history.assertSnapshot(); syncQuiet.assertCurrent(); coverage?.assertCurrent()
    if (hasActiveConversationWork()) return fail('busy')
  } }
  const open = async () => {
    const dbs = await openRestoreDatabases([{ descriptor: { name: WORKSPACE_CONTROL_DB, version: 1 }, shape: CONTROL_SHAPE },
      { descriptor: layout.files, shape: FILE_SHAPE }, { descriptor: layout.projects, shape: PROJECT_SHAPE }], guard)
    return [dbs[0]!, dbs[1]!, dbs[2]!] as const
  }
  try {
    guard.assertCurrent()
    const local = restoreLocalSnapshot({ owner: scope.owner, generation: layout.generation })
    if (local.history[2] !== null || local.history[3] !== null) return fail('unavailable')
    const source = local.history[0] ?? (local.history[1] === null ? '[]' : await decrypt(local.history[1]!))
    if (canonicalSyncJSON(JSON.parse(source), { nodes: 1_000_000, chars: 32 * 1024 * 1024 }) !== history.json) throw new Error('history-not-durable')
    guard.assertCurrent(); assertRestoreLocal(local, guard)
    const plan = await planExistingSyncUpdate(args); guard.assertCurrent()
    coverage = await attestMaterializedTargets({ materialized: args.materialized, bindings: args.bindings, targetIds: plan.targets, authority: args.authority })
    guard.assertCurrent()
    const [control, files, projects] = await open()
    try {
      const base = await transact(control, ['meta'], 'readonly', guard, async tx => {
        const store = tx.objectStore('meta')
        if (await store.count() !== 1) return fail()
        return parseRestoreReady(await store.get(WORKSPACE_CONTROL_KEY)) ?? fail()
      })
      if (base.generation !== layout.generation || controlProjectsVersion(base) !== 2 || !equal(base.requiredOwners, layout.requiredOwners)) return fail()
      const collectOccupied = async (fileDB = files, projectDB = projects) => {
        const ids = createSyncIdentityInventory()
        ids.inspect(history.snapshot)
        for (const [db, stores] of [[fileDB, ['files']], [projectDB, ['projects', 'documents']]] as const)
          await transact(db, [...stores], 'readonly', guard, async tx => {
            for (const name of stores) {
              let cursor = await tx.objectStore(name).openCursor()
              while (cursor) {
                guard.assertCurrent(); ids.inspectRow(cursor.key, cursor.value)
                cursor = await cursor.continue()
              }
            }
          })
        return ids
      }
      const occupied = await collectOccupied(), newIds = new Set<string>()
      const projection = plan.project(id => coverage!.status(id) === 'equal', () => {
        guard.assertCurrent(); const id = crypto.randomUUID()
        if (occupied.has(id) || newIds.has(id)) return fail()
        newIds.add(id); return id
      })
      const chats = projection.projected.flatMap(v => v.content.kind === 'conversation' ? [v.content.conversation] : [])
      const catalogs = projection.projected.flatMap(v => v.content.kind === 'project' ? [v.content.project] : [])
      if (chats.length > 100 || catalogs.length > 20) return fail('limit')
      // Detached display data only: never an alternate list of write targets.
      const targets: { kind: 'conversation' | 'project'; localId: string; before: string; after: string }[] = chats.map(chat => {
        const before = history.snapshot.find(c => c.id === chat.id)
        if (!before) return fail()
        return { kind: 'conversation', localId: chat.id, before: before.title, after: chat.title }
      })
      const variants = args.reviewed.variants
      const retained = projection.retained.filter(r => r.reason !== 'unchanged').map(r => {
        const content = variants.find(v => v.recordId === r.recordId)?.content
        return { ...r, label: content?.kind === 'conversation' ? content.data.conversation.title : content?.kind === 'project' ? content.data.name : null }
      })
      if (!chats.length && !catalogs.length) {
        await coverage.validateFresh(); guard.assertCurrent(); assertRestoreLocal(local, guard)
        return Object.freeze({ preview: Object.freeze({ status: 'existing-update-reviewed' as const, canApply: false, conversations: 0, projects: 0,
          targets, retained, journalBytes: 0, selectionUnchanged: true as const }), dispose, async commit() { return fail('unavailable') } })
      }
      const stateAfter = await args.sealState(projection.materialized, projection.bindings); guard.assertCurrent()
      const fence = await transact(projects, ['meta'], 'readonly', guard, tx => readSyncUpdateFence(tx, scope.owner))
      if ((fence.present ? fence.value : 'initial') !== scope.fence) return fail()
      const p: SyncUpdatePayload = { version: 1, id: crypto.randomUUID(), generation: layout.generation, owner: scope.owner, fence,
        localFence: localStorage.getItem('arty-project-erasure-fence'), baseline: { localHash: await digestRaw(local.other), history: await proveRestoreSlots(local.history), stores: [] },
        projects: [], historyCipher: null, stateBefore, stateAfter }
      // Count both old/new encrypted project/state values, plus the new full
      // history. Old history is held in RAM and committed by bounded hashes.
      let accumulated = stateBefore.ciphertext.length + stateAfter.ciphertext.length + 2 * 1024 * 1024
      const seal = async (text: string, max = 24 * 1024 * 1024) => {
        const estimate = 3 + 4 * Math.ceil((new TextEncoder().encode(text).length + 28) / 3)
        if (estimate > max || accumulated + estimate > SYNC_APPLY_BYTES) return fail('limit')
        const cipher = await encrypt(text); guard.assertCurrent(); accumulated += cipher.length; return cipher
      }
      for (const catalog of catalogs) {
        const row = await transact(projects, ['projects'], 'readonly', guard, async tx => tx.objectStore('projects').get([scope.owner, catalog.id])) as RestoreProject
        if (!row) return fail()
        const before = await decodeProjectSnapshot(scope.owner, row, guard.assertCurrent); guard.assertCurrent()
        if (!equal(before.documents, catalog.documents) || before.euOnly !== catalog.euOnly || before.createdAt !== catalog.createdAt) return fail()
        targets.push({ kind: 'project', localId: catalog.id, before: before.name, after: catalog.name })
        const after = { ...catalog, owner: scope.owner, revision: before.revision + 1 }
        if (!validProject(after)) return fail('format')
        accumulated += row.cipher.length
        p.projects.push({ before: structuredClone(row), after: { ...row, revision: after.revision, updatedAt: after.updatedAt, cipher: await seal(JSON.stringify(after), 100_000) } })
      }
      if (chats.length) {
        const replacements = new Map(chats.map(c => [c.id, c])), counts = new Map<string, number>()
        const next = history.snapshot.map(c => { if (!replacements.has(c.id)) return c; counts.set(c.id, (counts.get(c.id) ?? 0) + 1); return replacements.get(c.id)! })
        if (chats.some(c => counts.get(c.id) !== 1)) return fail()
        p.historyCipher = await seal(JSON.stringify(next satisfies Conversation[]))
      }
      p.baseline.stores = await syncUpdateStoreProof(files, projects, p, guard)
      const validate = async (fileDB = files, projectDB = projects) => {
        await coverage!.validateFresh(); await args.authority.validateReadOnly(); await scope.validateReadOnly(); guard.assertCurrent()
        if (!equal(await syncUpdateStoreProof(fileDB, projectDB, p, guard), p.baseline.stores)) return fail()
        if (await transact(projectDB, ['meta', 'projects'], 'readonly', guard, tx => assertSyncUpdateRows(tx, p)) !== 'before') return fail()
        const current = await collectOccupied(fileDB, projectDB)
        if ([...newIds].some(id => current.has(id))) return fail()
        guard.assertCurrent(); assertRestoreLocal(local, guard)
      }
      await validate()
      raw = JSON.stringify(p)
      const bytes = new TextEncoder().encode(raw).length
      if (bytes > SYNC_APPLY_BYTES) return fail('limit')
      const header: SyncUpdateHeader = { format: 'arty-workspace-control', version: 11, layout: 'isolated-v1', state: 'applying', projectsVersion: 2,
        revision: base.revision + 1, generation: base.generation, requiredOwners: [...base.requiredOwners], base,
        apply: { id: p.id, owner: scope.owner, phase: 'prepared', bytes, hash: await digestText(raw) } }
      if (!parseSyncUpdateHeader(header)) return fail('format')
      await parseSyncUpdatePayload(raw, header, guard)
      return Object.freeze({ preview: Object.freeze({ status: 'existing-update-reviewed' as const, canApply: true, conversations: chats.length,
        projects: catalogs.length, targets, retained, journalBytes: bytes, selectionUnchanged: true as const }), dispose, async commit() {
        if (attempted) return fail()
        guard.assertCurrent(); attempted = true
        const release = syncQuiet.claimPublication()
        try {
          const [control, files, projects] = await open()
          try {
            await validate(files, projects)
            try {
              await transact(control, ['meta'], 'readwrite', guard, async tx => {
                const store = tx.objectStore('meta')
                if (await store.count() !== 1 || !equal(await store.get(WORKSPACE_CONTROL_KEY), base) || raw === undefined) return fail()
                guard.assertCurrent(); assertRestoreLocal(local, guard)
                await store.add(raw, syncUpdateJobKey(p.id)); guard.assertCurrent(); assertRestoreLocal(local, guard)
                await store.put(header, WORKSPACE_CONTROL_KEY); guard.assertCurrent(); assertRestoreLocal(local, guard)
              })
            } finally { dispose(); capturedDocument.retire() }
          } finally { control.close(); files.close(); projects.close() }
        } finally { release() }
      } })
    } finally { control.close(); files.close(); projects.close() }
  } catch (error) { dispose(); throw error }
}
