import type { Conversation } from '../../types'
import { captureLocalReadScope } from '../projects/store'
import { validProject } from '../projects/types'
import { captureHistoryForRestore } from '../storage'
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
import { SYNC_APPLY_BYTES, parseSyncApplyHeader, syncApplyJobKey, type SyncApplyHeader } from '../workspaceWriter/syncApplyProtocol'
import { parseSyncApplyPayload, syncApplyStoreProof, type SyncApplyPayload } from '../workspaceWriter/syncApplyJournal'
import { restoreEqual as equal, restoreFail as fail, openRestoreDatabases, restoreTransaction as transact, restoreLocalSnapshot,
  assertRestoreLocal, deriveRestoreUsage, validRestoreUsage, zeroRestoreUsage, proveRestoreSlots } from '../workspaceWriter/restoreJournal'
import { digestRaw, digestText } from '../workspaceWriter/migrationInventory'
import type { ReviewedSyncContent } from './receivedContent'
import type { ReceivedSyncChain } from './reception'
import type { SyncStateRow } from './localFormat'
import type { SyncDispatchGuard } from './clientTransport'
import type { SyncManifest } from './types'
import type { SyncLocalBinding } from './privateState'
import { parseSyncManifest } from './schema'

/** Internal warm seam called only from the receipt-owning actor. It derives
 * owner/layout/history/addresses itself. UI gets a detached preview, never
 * these parameters or a way to inject ciphertexts/targets for publication. */
export async function prepareFirstSyncApply(args: {
  receipt: ReceivedSyncChain; reviewed: ReviewedSyncContent; stateBefore: SyncStateRow
  authority: SyncDispatchGuard
  sealState(materialized: SyncManifest, bindings: SyncLocalBinding[]): Promise<SyncStateRow>
}) {
  if (!ISOLATED_WORKSPACE_ENABLED || !WORKSPACE_SYNC_APPLY_START_ENABLED || isNative) return fail('unavailable')
  const scope = captureLocalReadScope(args.authority.signal), history = captureHistoryForRestore(), layout = getDocumentStorageLayout()
  if (layout.kind !== 'isolated-v1' || layout.projects.version !== 2 || scope.owner === 'anon') return fail('unavailable')
  const stateBefore = structuredClone(args.stateBefore), capturedDocument = documentWorkspace, syncQuiet = captureLocalSyncQuiescence()
  if (stateBefore.owner !== scope.owner || stateBefore.generation !== layout.generation || stateBefore.pending) return fail('format')
  let disposed = false, attempted = false, raw: string | undefined
  const lifetime = new AbortController(), signals = [documentWorkspaceSignal, args.receipt.signal, args.authority.signal]
  const dispose = () => {
    disposed = true; raw = undefined; lifetime.abort()
    for (const signal of signals) signal?.removeEventListener('abort', dispose)
  }
  for (const signal of signals) signal?.addEventListener('abort', dispose, { once: true })
  if (signals.some(signal => signal?.aborted)) dispose()
  const guard = { signal: lifetime.signal, assertCurrent() {
    if (disposed || lifetime.signal.aborted) return fail('cancelled')
    if (!WORKSPACE_SYNC_APPLY_START_ENABLED) return fail('unavailable')
    args.authority.assertCurrent(); args.reviewed.assertCurrent(); args.receipt.assertCurrent()
    scope.assertCurrent(); history.assertSnapshot(); syncQuiet.assertCurrent()
    if (hasActiveConversationWork()) return fail('busy')
  } }
  try {
    const local = restoreLocalSnapshot({ generation: layout.generation, owner: scope.owner })
    if (local.history[2] !== null || local.history[3] !== null) return fail('unavailable')
    guard.assertCurrent(); await scope.validateReadOnly(); await args.authority.validateReadOnly(); guard.assertCurrent()
    const authoritative = local.history[0] ?? (local.history[1] == null ? '[]' : await decrypt(local.history[1]))
    let durable: unknown
    try { durable = JSON.parse(authoritative) } catch { return fail('format') }
    // A legacy streaming/connector sanitization may exist only in RAM. Never
    // overwrite or silently normalize B as a side effect of reviewing an import.
    // The UI gives a specific normal-save action, not an endless reload retry.
    if (!equal(durable, history.snapshot)) throw new Error('history-not-durable')
    guard.assertCurrent()
    const open = async () => {
      const dbs = await openRestoreDatabases([{ descriptor: { name: WORKSPACE_CONTROL_DB, version: 1 }, shape: CONTROL_SHAPE },
        { descriptor: layout.files, shape: FILE_SHAPE }, { descriptor: layout.projects, shape: PROJECT_SHAPE }], guard)
      return [dbs[0]!, dbs[1]!, dbs[2]!] as const
    }
    const [control, files, projects] = await open()
    try {
      const base = await transact(control, ['meta'], 'readonly', guard, async tx => {
        const store = tx.objectStore('meta')
        if (await store.count() !== 1) return fail()
        return parseRestoreReady(await store.get(WORKSPACE_CONTROL_KEY)) ?? fail()
      })
      if (base.generation !== layout.generation || controlProjectsVersion(base) !== 2 || !equal(base.requiredOwners, layout.requiredOwners)) return fail()
      const collectOccupied = async (fileDB = files, projectDB = projects) => {
        const ids = new Set<string>(), stack: unknown[] = [history.snapshot], seen = new Set<object>()
        const inspect = (value: unknown) => {
          stack.push(value)
          while (stack.length) {
            const next = stack.pop()
            if (typeof next === 'string') ids.add(next)
            else if (next && typeof next === 'object' && !seen.has(next)) {
              seen.add(next); if (seen.size > 1_000_000) return fail('limit')
              for (const child of Object.values(next)) stack.push(child)
            }
          }
        }
        inspect(null)
        for (const [db, stores] of [[fileDB, ['files']], [projectDB, ['projects', 'documents']]] as const)
          await transact(db, [...stores], 'readonly', guard, async tx => {
            for (const store of stores) {
              let cursor = await tx.objectStore(store).openCursor()
              while (cursor) {
                guard.assertCurrent(); inspect(cursor.key)
                const row = cursor.value as Record<string, unknown>
                if (!row || typeof row !== 'object') return fail('format')
                for (const field of ['id', 'fileId', 'projectId']) {
                  if (row[field] !== undefined && typeof row[field] !== 'string') return fail('format')
                  inspect(row[field])
                }
                cursor = await cursor.continue()
              }
            }
          })
        return ids
      }
      const occupied = await collectOccupied(), newIds = new Set<string>()
      const reserve = () => {
        guard.assertCurrent()
        const id = crypto.randomUUID()
        if (occupied.has(id) || newIds.has(id)) return fail()
        newIds.add(id); return id
      }
      const remote = args.receipt.manifest, empty = parseSyncManifest({ ...remote, records: [] })
      const projection = args.reviewed.projectLocal(empty, [], reserve)
      const selected = new Set(projection.projected.map(v => v.recordId))
      const materialized = parseSyncManifest({ ...remote, records: remote.records.filter(r => selected.has(r.id)) })
      const projected = projection.projected.map(v => v.content)
      const chats = projected.flatMap(c => c.kind === 'conversation' ? [c.conversation] : [])
      const catalogs = projected.flatMap(c => c.kind === 'project' ? [c.project] : [])
      if (chats.length > 100 || catalogs.length > 20) return fail('limit')
      const usageBefore = await transact(projects, ['projects', 'documents', 'usage'], 'readonly', guard, async tx => {
        const usage = await tx.objectStore('usage').get(scope.owner) ?? null, derived = await deriveRestoreUsage(tx, scope.owner)
        if (!equal(derived, usage ?? zeroRestoreUsage(scope.owner)) || usage !== null && !validRestoreUsage(usage, scope.owner)) return fail()
        return usage
      })
      const before = usageBefore ?? zeroRestoreUsage(scope.owner), docs = catalogs.flatMap(p => p.documents)
      const usageAfter = { owner: scope.owner, projects: before.projects + catalogs.length, documents: before.documents + docs.length,
        sourceBytes: before.sourceBytes + docs.reduce((n, d) => n + d.sourceBytes, 0) }
      if (!validRestoreUsage(usageAfter, scope.owner)) return fail('limit')
      const stateAfter = await args.sealState(materialized, projection.bindings); guard.assertCurrent()
      const p: SyncApplyPayload = { version: 1, id: crypto.randomUUID(), generation: layout.generation, owner: scope.owner, fence: scope.fence, newIds: [...newIds],
        baseline: { localHash: await digestRaw(local.other), history: await proveRestoreSlots(local.history), stores: [] },
        files: [], projects: [], documents: [], usageBefore, usageAfter, historyCipher: null, stateBefore, stateAfter }
      let accumulated = stateBefore.ciphertext.length + stateAfter.ciphertext.length + 2 * 1024 * 1024
      const encryptForJournal = async (text: string) => {
        const estimate = 3 + 4 * Math.ceil((new TextEncoder().encode(text).length + 28) / 3)
        if (estimate > 24 * 1024 * 1024 || accumulated + estimate > SYNC_APPLY_BYTES) return fail('limit')
        const value = await encrypt(text); guard.assertCurrent(); accumulated += value.length
        return value
      }
      const base64 = async (blob: Blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer()); guard.assertCurrent()
        try {
          const pieces: string[] = []
          for (let i = 0; i < bytes.length; i += 0x8000) pieces.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)))
          return btoa(pieces.join(''))
        } finally { bytes.fill(0) }
      }
      for (const item of projected) if (item.kind === 'file') {
        const { id, type, size: _bytes, recordedSize, ...metadata } = item.file
        accumulated += new TextEncoder().encode(JSON.stringify(metadata)).length
        p.files.push({ ...metadata, fileId: id, ownerKey: `arty-${scope.owner}`, mimeType: type, size: recordedSize,
          encryptedData: await encryptForJournal(await base64(item.binary)) })
      }
      for (const catalog of catalogs) {
        const project = { ...catalog, owner: scope.owner, revision: 1 }
        if (!validProject(project)) return fail('format')
        p.projects.push({ key: [scope.owner, project.id], owner: scope.owner, id: project.id, revision: 1, state: 'live', euOnly: project.euOnly,
          createdAt: project.createdAt, updatedAt: project.updatedAt, cipher: await encryptForJournal(JSON.stringify(project)) })
        for (const d of project.documents) for (const kind of ['source', 'text'] as const) {
          const item = projected.find(c => c.kind === 'project-source' && kind === 'source' && c.projectId === project.id && c.document.id === d.id ||
            c.kind === 'project-text' && kind === 'text' && c.projectId === project.id && c.documentId === d.id)
          if (!item || item.kind !== 'project-source' && item.kind !== 'project-text') return fail('format')
          const content = item.kind === 'project-source' ? await base64(item.binary) : item.text
          p.documents.push({ key: [scope.owner, project.id, d.id, kind], owner: scope.owner, projectId: project.id, id: d.id, kind, state: 'live',
            sourceBytes: d.sourceBytes, textChars: d.textChars, updatedAt: project.updatedAt,
            cipher: await encryptForJournal(JSON.stringify({ schema: 1, owner: scope.owner, projectId: project.id, kind, descriptor: d, content })) })
        }
      }
      if (chats.length) p.historyCipher = await encryptForJournal(JSON.stringify([...chats, ...history.snapshot] satisfies Conversation[]))
      p.baseline.stores = await syncApplyStoreProof(files, projects, p, guard)
      const assertIdsAbsent = async (fileDB = files, projectDB = projects) => { const current = await collectOccupied(fileDB, projectDB); if ([...newIds].some(id => current.has(id))) return fail() }
      await assertIdsAbsent(); await args.authority.validateReadOnly(); await scope.validateReadOnly(); guard.assertCurrent(); assertRestoreLocal(local, guard)
      raw = JSON.stringify(p)
      const bytes = new TextEncoder().encode(raw).length
      if (bytes > SYNC_APPLY_BYTES) return fail('limit')
      const header: SyncApplyHeader = { format: 'arty-workspace-control', version: 10, layout: 'isolated-v1', state: 'applying', projectsVersion: 2,
        revision: base.revision + 1, generation: base.generation, requiredOwners: [...base.requiredOwners], base,
        apply: { id: p.id, owner: scope.owner, phase: 'prepared', bytes, hash: await digestText(raw) } }
      if (!parseSyncApplyHeader(header)) return fail('format')
      await parseSyncApplyPayload(raw, header, guard)
      const preview = { status: 'first-apply-prepared' as const, conversations: chats.length, projects: catalogs.length, documents: docs.length,
        files: p.files.length, retainedNotApplied: projection.retainedNotMaterialized.length, journalBytes: bytes, selectionUnchanged: true as const }
      return Object.freeze({ preview: Object.freeze(preview), dispose, async commit() {
        if (attempted) return fail()
        guard.assertCurrent(); attempted = true
        const release = syncQuiet.claimPublication()
        try {
          const [control, files, projects] = await open()
          try {
            await assertIdsAbsent(files, projects)
            if (!equal(await syncApplyStoreProof(files, projects, p, guard), p.baseline.stores)) return fail()
            await args.authority.validateReadOnly(); await scope.validateReadOnly(); guard.assertCurrent(); assertRestoreLocal(local, guard)
            try {
              await transact(control, ['meta'], 'readwrite', guard, async tx => {
                const store = tx.objectStore('meta')
                if (await store.count() !== 1 || !equal(await store.get(WORKSPACE_CONTROL_KEY), base) || raw === undefined) return fail()
                guard.assertCurrent(); assertRestoreLocal(local, guard)
                await store.add(raw, syncApplyJobKey(p.id)); guard.assertCurrent(); assertRestoreLocal(local, guard)
                await store.put(header, WORKSPACE_CONTROL_KEY)
              })
            } finally { dispose(); capturedDocument.retire() }
          } finally { control.close(); files.close(); projects.close() }
        } finally { release() }
      } })
    } finally { control.close(); files.close(); projects.close() }
  } catch (error) { dispose(); throw error }
}
