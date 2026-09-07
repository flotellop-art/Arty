import type { IDBPDatabase } from 'idb'
import { PROJECT_LIMITS, boundedInteger } from '../projects/types'
import { parseSyncStorageRow, type SyncStateRow, syncStorageContext } from '../workspaceSync/localFormat'
import { inspectSyncInventory } from '../workspaceSync/localInventory'
import { exactResetFields as fields, resetUuid } from './resetProtocol'
import { restoreHash } from './restoreProtocol'
import { isolatedWorkspaceLayout } from './layout'
import { digestText, digestRaw, rawEncoding, RAW_STORES, scanRawStore, type StoreDigest } from './migrationInventory'
import { SYNC_APPLY_BYTES, type SyncApplyHeader } from './syncApplyProtocol'
import { restoreEqual as equal, restoreFail as fail, validRestoreUsage, zeroRestoreUsage, proveRestoreSlots, restoreTransaction,
  type RestoreFile, type RestoreProject, type RestoreDocument, type RestoreUsage, type SlotProof, type RestoreGuard } from './restoreJournal'

/** First materialization only: all physical targets are new, M was empty, no
 * pending A is replaced. Updates/conflicts need a different owned preparation,
 * never relabelled copies. The job contains no account/vault key or plaintext
 * history, and neither these DTOs nor the parser authorize warm publication. */
export interface SyncApplyPayload {
  version: 1; id: string; generation: string; owner: string; fence: string; newIds: string[]
  baseline: { localHash: string; history: SlotProof[]; stores: StoreDigest[] }
  files: RestoreFile[]; projects: RestoreProject[]; documents: RestoreDocument[]
  usageBefore: RestoreUsage | null; usageAfter: RestoreUsage; historyCipher: string | null
  stateBefore: SyncStateRow; stateAfter: SyncStateRow
}
const cipher = (v: unknown): v is string => typeof v === 'string' && v.length >= 43 && v.length <= 24 * 1024 * 1024 && /^v[12]:[A-Za-z0-9+/]+={0,2}$/.test(v)
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
/** Root and exact two-key inventory must have been admitted before this read. */
export async function parseSyncApplyPayload(raw: unknown, header: SyncApplyHeader, guard: RestoreGuard): Promise<SyncApplyPayload> {
  guard.assertCurrent()
  if (typeof raw !== 'string' || raw.length > SYNC_APPLY_BYTES || new TextEncoder().encode(raw).length !== header.apply.bytes ||
    await digestText(raw) !== header.apply.hash) return fail('format')
  guard.assertCurrent()
  let v: unknown
  try { v = JSON.parse(raw) } catch { return fail('format') }
  if (!fields(v, ['version', 'id', 'generation', 'owner', 'fence', 'newIds', 'baseline', 'files', 'projects', 'documents', 'usageBefore', 'usageAfter', 'historyCipher', 'stateBefore', 'stateAfter']) ||
    v.version !== 1 || v.id !== header.apply.id || v.generation !== header.generation || v.owner !== header.apply.owner ||
    typeof v.fence !== 'string' || !v.fence.length || v.fence.length > 128 ||
    !Array.isArray(v.newIds) || v.newIds.length > 10_000 || !v.newIds.every(resetUuid) || new Set(v.newIds).size !== v.newIds.length ||
    !fields(v.baseline, ['localHash', 'history', 'stores']) || !restoreHash(v.baseline.localHash) ||
    !Array.isArray(v.baseline.history) || v.baseline.history.length !== 4 || !v.baseline.history.every(p => p === null || fields(p, ['length', 'hash']) && boundedInteger(p.length, 24 * 1024 * 1024) && restoreHash(p.hash)) ||
    v.baseline.history[2] !== null || v.baseline.history[3] !== null ||
    !Array.isArray(v.baseline.stores) || v.baseline.stores.length !== RAW_STORES.length || !v.baseline.stores.every((p, i) => fields(p, ['store', 'count', 'hash']) && p.store === RAW_STORES[i] && boundedInteger(p.count) && restoreHash(p.hash)) ||
    !Array.isArray(v.files) || v.files.length > 128 || !Array.isArray(v.projects) || v.projects.length > PROJECT_LIMITS.projects ||
    !Array.isArray(v.documents) || v.documents.length > PROJECT_LIMITS.documentsPerOwner * 2 ||
    v.usageBefore !== null && !validRestoreUsage(v.usageBefore, header.apply.owner) || !validRestoreUsage(v.usageAfter, header.apply.owner) ||
    v.historyCipher !== null && !cipher(v.historyCipher) || v.files.length > 0 && v.historyCipher === null) return fail('format')
  const p = v as unknown as SyncApplyPayload, ids = new Set<string>(), projectIds = new Set<string>(), docs = new Map<string, RestoreDocument>(), docKeys = new Set<string>()
  const unique = (id: string) => { if (!p.newIds.includes(id) || ids.has(id)) fail('format'); ids.add(id) }
  for (const f of p.files) {
    if (!fields(f, ['fileId', 'ownerKey', 'name', 'mimeType', 'size', 'encryptedData', 'createdAt', ...['width', 'height', 'normalizationVersion'].filter(k => own(f, k))]) ||
      f.ownerKey !== `arty-${p.owner}` || typeof f.name !== 'string' || typeof f.mimeType !== 'string' || !boundedInteger(f.size) ||
      !Number.isSafeInteger(f.createdAt) || !cipher(f.encryptedData) || ['width', 'height', 'normalizationVersion'].some(k => own(f, k) && !boundedInteger(f[k]))) return fail('format')
    unique(f.fileId)
  }
  for (const row of p.projects) {
    if (!fields(row, ['key', 'owner', 'id', 'revision', 'state', 'euOnly', 'createdAt', 'updatedAt', 'cipher']) || row.owner !== p.owner || row.state !== 'live' || row.revision !== 1 ||
      !equal(row.key, [p.owner, row.id]) || typeof row.euOnly !== 'boolean' || !boundedInteger(row.createdAt) || !boundedInteger(row.updatedAt) || !cipher(row.cipher)) return fail('format')
    unique(row.id); projectIds.add(row.id)
  }
  for (const d of p.documents) {
    if (!fields(d, ['key', 'owner', 'projectId', 'id', 'kind', 'state', 'sourceBytes', 'textChars', 'updatedAt', 'cipher']) || d.owner !== p.owner || d.state !== 'live' ||
      !projectIds.has(d.projectId) || !['source', 'text'].includes(d.kind) || !equal(d.key, [p.owner, d.projectId, d.id, d.kind]) ||
      !boundedInteger(d.sourceBytes, PROJECT_LIMITS.sourceBytes) || !d.sourceBytes || !boundedInteger(d.textChars, PROJECT_LIMITS.documentTextChars) || !boundedInteger(d.updatedAt) || !cipher(d.cipher)) return fail('format')
    const key = JSON.stringify(d.key), pair = JSON.stringify([d.projectId, d.id]), previous = docs.get(pair)
    if (docKeys.has(key)) return fail('format')
    docKeys.add(key)
    if (!previous) { unique(d.id); docs.set(pair, d) }
    else if (previous.kind === d.kind || previous.sourceBytes !== d.sourceBytes || previous.textChars !== d.textChars || previous.updatedAt !== d.updatedAt) return fail('format')
  }
  if (docs.size * 2 !== p.documents.length) return fail('format')
  const before = p.usageBefore ?? zeroRestoreUsage(p.owner)
  if (!equal(p.usageAfter, { owner: p.owner, projects: before.projects + p.projects.length, documents: before.documents + docs.size,
    sourceBytes: before.sourceBytes + [...docs.values()].reduce((n, d) => n + d.sourceBytes, 0) })) return fail('format')
  for (const id of projectIds) {
    const selected = [...docs.values()].filter(d => d.projectId === id)
    if (selected.length > PROJECT_LIMITS.documentsPerProject || selected.reduce((n, d) => n + d.textChars, 0) > PROJECT_LIMITS.projectTextChars) return fail('limit')
  }
  const key = ['sync-state', p.owner], context = { generation: p.generation }
  const a = parseSyncStorageRow(key, p.stateBefore, context), b = parseSyncStorageRow(key, p.stateAfter, context)
  if (a.format !== 'arty-sync-local-state' || b.format !== 'arty-sync-local-state' || a.pending || b.pending ||
    a.enrollmentId !== b.enrollmentId || a.vaultId !== b.vaultId || a.epoch !== b.epoch || b.revision !== a.revision + 1 ||
    b.version !== 2 || a.ciphertext === b.ciphertext) return fail('format')
  if (p.historyCipher !== null && equal((await proveRestoreSlots([p.historyCipher]))[0], p.baseline.history[1])) return fail('format')
  guard.assertCurrent(); return p
}
export const syncApplyRows = (p: SyncApplyPayload) => [['files', p.files], ['projects', p.projects], ['documents', p.documents]] as const
/** Baseline excludes ONLY exact job copies, own usage and exact before/after
 * state. Every other owner, row and metadata field stays in the digest. */
export async function syncApplyStoreProof(files: IDBPDatabase, projects: IDBPDatabase, p: SyncApplyPayload, guard: RestoreGuard): Promise<StoreDigest[]> {
  const context = syncStorageContext(isolatedWorkspaceLayout(p.generation, [], 2), projects)
  await restoreTransaction(projects, ['meta'], 'readonly', guard, async tx => { await inspectSyncInventory(tx.objectStore('meta'), context, guard.assertCurrent) })
  const proof: StoreDigest[] = []
  for (const store of RAW_STORES) {
    const rows = syncApplyRows(p).find(([name]) => name === store)?.[1] ?? []
    const targets = new Map(rows.map(row => [rawEncoding('fileId' in row ? row.fileId : row.key), row]))
    let hash = await digestText('arty-sync-apply-baseline-v1'), count = 0
    await scanRawStore(store === 'files' ? files : projects, store, guard.assertCurrent, guard.signal, async rows => {
      for (const row of rows) {
        if (store === 'usage' && row.key === p.owner) continue
        if (store === 'meta' && equal(row.key, ['sync-state', p.owner])) {
          if (!equal(row.value, p.stateBefore) && !equal(row.value, p.stateAfter)) return fail()
          continue
        }
        const target = targets.get(rawEncoding(row.key))
        if (target) { if (!equal(target, row.value)) return fail(); continue }
        hash = await digestText(JSON.stringify([hash, await digestRaw([row.key, row.value])])); count++; guard.assertCurrent()
      }
    })
    proof.push({ store, count, hash })
  }
  return proof
}
