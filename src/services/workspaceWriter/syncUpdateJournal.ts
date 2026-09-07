import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { boundedInteger, validProjectId, PROJECT_LIMITS } from '../projects/types'
import { parseSyncStorageRow, syncStorageContext, type SyncStateRow } from '../workspaceSync/localFormat'
import { inspectSyncInventory } from '../workspaceSync/localInventory'
import { exactResetFields as fields } from './resetProtocol'
import { validErasureFence } from './erasureProtocol'
import { restoreHash } from './restoreProtocol'
import { isolatedWorkspaceLayout } from './layout'
import { digestText, digestRaw, rawEncoding, RAW_STORES, scanRawStore, type StoreDigest } from './migrationInventory'
import { SYNC_APPLY_BYTES } from './syncApplyProtocol'
import type { SyncUpdateHeader } from './syncUpdateProtocol'
import { restoreEqual as equal, restoreFail as fail, restoreTransaction, proveRestoreSlots,
  type RestoreProject, type SlotProof, type RestoreGuard } from './restoreJournal'

export type SyncUpdateFence = { present: false } | { present: true; value: string }
export interface SyncUpdatePayload {
  version: 1; id: string; generation: string; owner: string; fence: SyncUpdateFence; localFence: string | null
  baseline: { localHash: string; history: SlotProof[]; stores: StoreDigest[] }
  projects: { before: RestoreProject; after: RestoreProject }[]
  historyCipher: string | null
  stateBefore: SyncStateRow; stateAfter: SyncStateRow
}
const cipher = (v: unknown): v is string => typeof v === 'string' && v.length >= 43 && v.length <= 24 * 1024 * 1024 && /^v[12]:[A-Za-z0-9+/]+={0,2}$/.test(v)
const fenceValid = (v: unknown): v is SyncUpdateFence => fields(v, ['present']) && v.present === false ||
  fields(v, ['present', 'value']) && v.present === true && validErasureFence(v.value)
const projectValid = (v: unknown, owner: string): v is RestoreProject => fields(v, ['key', 'owner', 'id', 'revision', 'state', 'euOnly', 'createdAt', 'updatedAt', 'cipher']) &&
  v.owner === owner && validProjectId(v.id) && equal(v.key, [owner, v.id]) && v.state === 'live' &&
  boundedInteger(v.revision) && (v.revision as number) > 0 && typeof v.euOnly === 'boolean' && boundedInteger(v.createdAt) && boundedInteger(v.updatedAt) &&
  cipher(v.cipher) && v.cipher.length <= 100_000

/** Only after exact root+job inventory admission. BEFORE project/state values
 * are ciphertext; history BEFORE is a bounded commitment, never plaintext.
 * Forward-only recovery needs no key, network or newly allocated identity. */
export async function parseSyncUpdatePayload(raw: unknown, h: SyncUpdateHeader, guard: RestoreGuard): Promise<SyncUpdatePayload> {
  guard.assertCurrent()
  if (typeof raw !== 'string' || raw.length > SYNC_APPLY_BYTES || new TextEncoder().encode(raw).length !== h.apply.bytes || await digestText(raw) !== h.apply.hash) return fail('format')
  guard.assertCurrent()
  let v: unknown
  try { v = JSON.parse(raw) } catch { return fail('format') }
  if (!fields(v, ['version', 'id', 'generation', 'owner', 'fence', 'localFence', 'baseline', 'projects', 'historyCipher', 'stateBefore', 'stateAfter']) ||
    v.version !== 1 || v.id !== h.apply.id || v.generation !== h.generation || v.owner !== h.apply.owner || !fenceValid(v.fence) ||
    v.localFence !== null && !validErasureFence(v.localFence) ||
    (v.fence.present ? v.fence.value : 'initial') !== (v.localFence ?? 'initial') ||
    !fields(v.baseline, ['localHash', 'history', 'stores']) || !restoreHash(v.baseline.localHash) ||
    !Array.isArray(v.baseline.history) || v.baseline.history.length !== 4 || !v.baseline.history.every(p => p === null || fields(p, ['length', 'hash']) && boundedInteger(p.length, 24 * 1024 * 1024) && restoreHash(p.hash)) ||
    v.baseline.history[2] !== null || v.baseline.history[3] !== null ||
    !Array.isArray(v.baseline.stores) || v.baseline.stores.length !== RAW_STORES.length || !v.baseline.stores.every((p, i) => fields(p, ['store', 'count', 'hash']) && p.store === RAW_STORES[i] && boundedInteger(p.count) && restoreHash(p.hash)) ||
    !Array.isArray(v.projects) || v.projects.length > PROJECT_LIMITS.projects || v.historyCipher !== null && !cipher(v.historyCipher) ||
    !v.projects.length && v.historyCipher === null) return fail('format')
  const p = v as unknown as SyncUpdatePayload, ids = new Set<string>()
  for (const pair of p.projects) {
    if (!fields(pair, ['before', 'after']) || !projectValid(pair.before, p.owner) || !projectValid(pair.after, p.owner) ||
      !equal(pair.before.key, pair.after.key) || pair.before.euOnly !== pair.after.euOnly || pair.before.createdAt !== pair.after.createdAt ||
      pair.after.revision !== pair.before.revision + 1 || pair.before.cipher === pair.after.cipher || ids.has(pair.before.id)) return fail('format')
    ids.add(pair.before.id)
  }
  const key = ['sync-state', p.owner], context = { generation: p.generation }
  const a = parseSyncStorageRow(key, p.stateBefore, context), b = parseSyncStorageRow(key, p.stateAfter, context)
  // A creator that has only published still legitimately has a public v1 row.
  // parseSyncStorageRow admits v1/v2 BEFORE; every new materialized state is v2.
  if (a.format !== 'arty-sync-local-state' || b.format !== 'arty-sync-local-state' || b.version !== 2 || a.pending || b.pending ||
    a.enrollmentId !== b.enrollmentId || a.vaultId !== b.vaultId || a.epoch !== b.epoch || b.revision !== a.revision + 1 || a.ciphertext === b.ciphertext) return fail('format')
  if (p.historyCipher !== null && equal((await proveRestoreSlots([p.historyCipher]))[0], p.baseline.history[1])) return fail('format')
  guard.assertCurrent(); return p
}
export async function readSyncUpdateFence(tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>, owner: string): Promise<SyncUpdateFence> {
  const meta = tx.objectStore('meta')
  if (await meta.getKey(['erasing', owner]) !== undefined) return fail()
  if (await meta.getKey('erasure-fence') === undefined) return { present: false }
  const value = await meta.get('erasure-fence')
  if (!validErasureFence(value)) return fail('format')
  return { present: true, value }
}
export async function assertSyncUpdateRows(tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>, p: SyncUpdatePayload): Promise<'before' | 'after'> {
  if (!equal(await readSyncUpdateFence(tx, p.owner), p.fence) || localStorage.getItem('arty-project-erasure-fence') !== p.localFence) return fail()
  const state = await tx.objectStore('meta').get(['sync-state', p.owner])
  const mode = equal(state, p.stateBefore) ? 'before' : equal(state, p.stateAfter) ? 'after' : fail()
  for (const pair of p.projects) if (!equal(await tx.objectStore('projects').get(pair.before.key), pair[mode])) return fail()
  return mode
}
/** Preserve ALL non-target rows, usage and metadata, including physical fence
 * presence. Exclude only exact BEFORE/AFTER of the target projects and state. */
export async function syncUpdateStoreProof(files: IDBPDatabase, projects: IDBPDatabase, p: SyncUpdatePayload, guard: RestoreGuard): Promise<StoreDigest[]> {
  const context = syncStorageContext(isolatedWorkspaceLayout(p.generation, [], 2), projects)
  await restoreTransaction(projects, ['meta'], 'readonly', guard, async tx => { await inspectSyncInventory(tx.objectStore('meta'), context, guard.assertCurrent) })
  const targets = new Map(p.projects.map(pair => [rawEncoding(pair.before.key), pair])), proof: StoreDigest[] = []
  for (const store of RAW_STORES) {
    let hash = await digestText('arty-sync-update-baseline-v1'), count = 0
    await scanRawStore(store === 'files' ? files : projects, store, guard.assertCurrent, guard.signal, async rows => {
      for (const row of rows) {
        const pair = store === 'projects' ? targets.get(rawEncoding(row.key)) : undefined
        if (pair) { if (!equal(row.value, pair.before) && !equal(row.value, pair.after)) return fail(); continue }
        if (store === 'meta' && equal(row.key, ['sync-state', p.owner])) {
          if (!equal(row.value, p.stateBefore) && !equal(row.value, p.stateAfter)) return fail()
          continue
        }
        hash = await digestText(JSON.stringify([hash, await digestRaw([row.key, row.value])])); count++; guard.assertCurrent()
      }
    })
    proof.push({ store, count, hash })
  }
  return proof
}
