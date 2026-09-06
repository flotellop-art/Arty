import type { IDBPDatabase, IDBPTransaction } from 'idb'
import { openExistingDB } from '../readOnlyExistingDB'
import { BackupError } from '../workspaceBackup/types'
import { PROJECT_LIMITS, boundedInteger } from '../projects/types'
import { exactResetFields as fields, resetUuid } from './resetProtocol'
import { restoreHash, RESTORE_PAYLOAD_BYTES, type RestoreHeader } from './restoreProtocol'
import { HISTORY_SLOTS, workspaceDataKey, isolatedWorkspaceLayout } from './layout'
import { digestRaw, digestText, localPairs, rawEncoding, scanRawStore, RAW_STORES, type StoreDigest, type RawStore } from './migrationInventory'
import { assertDatabaseShape, type StoreShape } from './schema'

export interface RestoreGuard { assertCurrent(): void; signal: AbortSignal }
export interface RestoreUsage { owner: string; projects: number; documents: number; sourceBytes: number }
export interface RestoreFile {
  fileId: string; ownerKey: string; name: string; mimeType: string; size: number; encryptedData: string; createdAt: number
  width?: number; height?: number; normalizationVersion?: number
}
export interface RestoreProject {
  key: [string, string]; owner: string; id: string; revision: number; state: 'live'
  euOnly: boolean; createdAt: number; updatedAt: number; cipher: string
}
export interface RestoreDocument {
  key: [string, string, string, 'source' | 'text']; owner: string; projectId: string; id: string
  kind: 'source' | 'text'; state: 'live'; sourceBytes: number; textChars: number; updatedAt: number; cipher: string
}
export type SlotProof = { length: number; hash: string } | null
export interface RestorePayload {
  version: 1; id: string; generation: string; owner: string; fence: string
  baseline: { localHash: string; history: SlotProof[]; stores: StoreDigest[] }
  files: RestoreFile[]; projects: RestoreProject[]; documents: RestoreDocument[]
  usageBefore: RestoreUsage | null; usageAfter: RestoreUsage; historyCipher: string | null
}
export const restoreFail = (code: 'changed' | 'format' | 'limit' | 'unavailable' | 'cancelled' | 'busy' = 'changed'): never => { throw new BackupError(code) }
export const restoreEqual = (a: unknown, b: unknown) => rawEncoding(a) === rawEncoding(b)
const cipher = (v: unknown): v is string => typeof v === 'string' && v.length >= 43 && v.length <= 24 * 1024 * 1024 && /^v[12]:[A-Za-z0-9+/]+={0,2}$/.test(v)
const smallString = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
const hasOwn = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
export const zeroRestoreUsage = (owner: string): RestoreUsage => ({ owner, projects: 0, documents: 0, sourceBytes: 0 })
export function validRestoreUsage(v: unknown, owner: string): v is RestoreUsage {
  return fields(v, ['owner', 'projects', 'documents', 'sourceBytes']) && v.owner === owner &&
    boundedInteger(v.projects, PROJECT_LIMITS.projects) && boundedInteger(v.documents, PROJECT_LIMITS.documentsPerOwner) && boundedInteger(v.sourceBytes, PROJECT_LIMITS.ownerSourceBytes)
}
/** Parse only AFTER root + exact job inventory admission. The durable string
 * bounds the structured clone; no secrets or old plaintext slots are stored. */
export async function parseRestorePayload(raw: unknown, header: RestoreHeader, guard: RestoreGuard): Promise<RestorePayload> {
  guard.assertCurrent()
  if (typeof raw !== 'string' || raw.length > RESTORE_PAYLOAD_BYTES) return restoreFail('format')
  if (new TextEncoder().encode(raw).length !== header.restore.bytes || await digestText(raw) !== header.restore.hash) return restoreFail('format')
  guard.assertCurrent()
  let v: unknown
  try { v = JSON.parse(raw) } catch { return restoreFail('format') }
  if (!fields(v, ['version', 'id', 'generation', 'owner', 'fence', 'baseline', 'files', 'projects', 'documents', 'usageBefore', 'usageAfter', 'historyCipher']) ||
    v.version !== 1 || v.id !== header.restore.id || v.generation !== header.generation || v.owner !== header.restore.owner || !smallString(v.fence, 128) ||
    !fields(v.baseline, ['localHash', 'history', 'stores']) || !restoreHash(v.baseline.localHash) ||
    !Array.isArray(v.baseline.history) || v.baseline.history.length !== 4 || !v.baseline.history.every(p => p === null || (fields(p, ['length', 'hash']) && boundedInteger(p.length, 16 * 1024 * 1024) && restoreHash(p.hash))) ||
    v.baseline.history[2] !== null || v.baseline.history[3] !== null ||
    !Array.isArray(v.baseline.stores) || v.baseline.stores.length !== RAW_STORES.length || !v.baseline.stores.every((p, i) => fields(p, ['store', 'count', 'hash']) && p.store === RAW_STORES[i] && boundedInteger(p.count) && restoreHash(p.hash)) ||
    !Array.isArray(v.files) || v.files.length > 128 || !Array.isArray(v.projects) || v.projects.length > PROJECT_LIMITS.projects ||
    !Array.isArray(v.documents) || v.documents.length > PROJECT_LIMITS.documentsPerOwner * 2 ||
    (v.usageBefore !== null && !validRestoreUsage(v.usageBefore, header.restore.owner)) || !validRestoreUsage(v.usageAfter, header.restore.owner) ||
    (v.historyCipher !== null && !cipher(v.historyCipher)) || (v.files.length > 0 && v.historyCipher === null)) return restoreFail('format')
  const p = v as unknown as RestorePayload, ids = new Set<string>(), projectIds = new Set<string>(), documents = new Map<string, RestoreDocument>(), documentKeys = new Set<string>()
  const unique = (id: string) => { if (!resetUuid(id) || ids.has(id)) restoreFail('format'); ids.add(id) }
  for (const f of p.files) {
    if (!fields(f, ['fileId', 'ownerKey', 'name', 'mimeType', 'size', 'encryptedData', 'createdAt', ...['width', 'height', 'normalizationVersion'].filter(k => hasOwn(f, k))]) ||
      f.ownerKey !== `arty-${p.owner}` || !smallString(f.name, 1024) || typeof f.mimeType !== 'string' || f.mimeType.length > 255 || !boundedInteger(f.size) || !boundedInteger(f.createdAt) || !cipher(f.encryptedData) ||
      ['width', 'height', 'normalizationVersion'].some(k => hasOwn(f, k) && !boundedInteger(f[k]))) return restoreFail('format')
    unique(f.fileId)
  }
  for (const project of p.projects) {
    if (!fields(project, ['key', 'owner', 'id', 'revision', 'state', 'euOnly', 'createdAt', 'updatedAt', 'cipher']) || project.owner !== p.owner || project.state !== 'live' ||
      !restoreEqual(project.key, [p.owner, project.id]) || !boundedInteger(project.revision) || project.revision < 1 || typeof project.euOnly !== 'boolean' ||
      !boundedInteger(project.createdAt) || !boundedInteger(project.updatedAt) || !cipher(project.cipher)) return restoreFail('format')
    unique(project.id); projectIds.add(project.id)
  }
  for (const d of p.documents) {
    if (!fields(d, ['key', 'owner', 'projectId', 'id', 'kind', 'state', 'sourceBytes', 'textChars', 'updatedAt', 'cipher']) || d.owner !== p.owner || d.state !== 'live' ||
      !projectIds.has(d.projectId) || !['source', 'text'].includes(d.kind) || !restoreEqual(d.key, [p.owner, d.projectId, d.id, d.kind]) ||
      !boundedInteger(d.sourceBytes, PROJECT_LIMITS.sourceBytes) || d.sourceBytes < 1 || !boundedInteger(d.textChars, PROJECT_LIMITS.documentTextChars) || !boundedInteger(d.updatedAt) || !cipher(d.cipher)) return restoreFail('format')
    if (documentKeys.has(JSON.stringify(d.key))) return restoreFail('format')
    documentKeys.add(JSON.stringify(d.key))
    const key = JSON.stringify([d.projectId, d.id]), previous = documents.get(key)
    if (!previous) { unique(d.id); documents.set(key, d) }
    else if (previous.kind === d.kind || previous.sourceBytes !== d.sourceBytes || previous.textChars !== d.textChars || previous.updatedAt !== d.updatedAt) return restoreFail('format')
  }
  if (documents.size * 2 !== p.documents.length) return restoreFail('format')
  const before = p.usageBefore ?? zeroRestoreUsage(p.owner)
  if (p.historyCipher !== null && restoreEqual((await proveRestoreSlots([p.historyCipher]))[0], p.baseline.history[1])) return restoreFail('format')
  if (!restoreEqual(p.usageAfter, { owner: p.owner, projects: before.projects + p.projects.length, documents: before.documents + documents.size,
    sourceBytes: before.sourceBytes + [...documents.values()].reduce((n, d) => n + d.sourceBytes, 0) })) return restoreFail('format')
  for (const id of projectIds) {
    const docs = [...documents.values()].filter(d => d.projectId === id)
    if (docs.length > PROJECT_LIMITS.documentsPerProject || docs.reduce((n, d) => n + d.textChars, 0) > PROJECT_LIMITS.projectTextChars) return restoreFail('format')
  }
  guard.assertCurrent(); return p
}

export async function restoreTransaction<T, M extends 'readonly' | 'readwrite'>(db: IDBPDatabase, stores: string[], mode: M, guard: RestoreGuard,
  work: (tx: IDBPTransaction<unknown, string[], M>) => Promise<T>): Promise<T> {
  guard.assertCurrent()
  const tx = db.transaction(stores, mode), abort = () => { try { tx.abort() } catch { /* settled */ } }
  guard.signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
  try { guard.assertCurrent(); const result = await work(tx); guard.assertCurrent(); await tx.done; guard.assertCurrent(); return result }
  catch (error) { abort(); await tx.done.catch(() => {}); throw error }
  finally { guard.signal.removeEventListener('abort', abort) }
}
export async function openRestoreDatabase(descriptor: { name: string; version: number }, shape: readonly StoreShape[], guard: RestoreGuard) {
  guard.assertCurrent()
  const db = await openExistingDB(descriptor.name, descriptor.version, guard.assertCurrent, guard.signal)
  if (!db) return restoreFail('unavailable')
  try {
    if (db.version !== descriptor.version) return restoreFail('format')
    await restoreTransaction(db, shape.map(s => s[0]), 'readonly', guard, async tx => { assertDatabaseShape(db, shape, tx) })
    return db
  } catch (error) { db.close(); throw error }
}
export async function openRestoreDatabases(descriptors: readonly { descriptor: { name: string; version: number }; shape: readonly StoreShape[] }[], guard: RestoreGuard) {
  const opened: IDBPDatabase[] = []
  try {
    for (const { descriptor, shape } of descriptors) opened.push(await openRestoreDatabase(descriptor, shape, guard))
    return opened
  } catch (error) { opened.forEach(db => db.close()); throw error }
}
export const restoreHistoryKeys = (p: Pick<RestorePayload, 'generation' | 'owner'>) => HISTORY_SLOTS.map(slot => workspaceDataKey(isolatedWorkspaceLayout(p.generation, []), p.owner, slot))
export function restoreLocalSnapshot(p: Pick<RestorePayload, 'generation' | 'owner'>) {
  const keys = restoreHistoryKeys(p), pairs = localPairs()
  return { pairs, history: keys.map(k => localStorage.getItem(k)), other: pairs.filter(([k]) => !keys.includes(k)) }
}
export const proveRestoreSlots = (slots: (string | null)[]): Promise<SlotProof[]> => Promise.all(slots.map(async s => s === null ? null : { length: s.length, hash: await digestText(JSON.stringify(s)) }))
export function assertRestoreLocal(snapshot: ReturnType<typeof restoreLocalSnapshot>, guard: RestoreGuard) {
  guard.assertCurrent()
  if (!restoreEqual(snapshot.pairs, localPairs())) restoreFail()
}
export function restoreTargets(p: RestorePayload, store: RawStore): Map<string, unknown> {
  if (store === 'files') return new Map(p.files.map(row => [rawEncoding(row.fileId), row]))
  if (store === 'projects') return new Map(p.projects.map(row => [rawEncoding(row.key), row]))
  if (store === 'documents') return new Map(p.documents.map(row => [rawEncoding(row.key), row]))
  return new Map()
}
/** Hash the baseline without persisting any source records. Existing rows for
 * all owners are included; only exact job copies and this usage are excluded. */
export async function restoreStoreProof(files: IDBPDatabase, projects: IDBPDatabase, p: RestorePayload, guard: RestoreGuard): Promise<StoreDigest[]> {
  const result: StoreDigest[] = []
  for (const store of RAW_STORES) {
    const targets = restoreTargets(p, store)
    let hash = await digestText('arty-restore-baseline-v1'), count = 0
    await scanRawStore(store === 'files' ? files : projects, store, guard.assertCurrent, guard.signal, async rows => {
      for (const row of rows) {
        if (store === 'usage' && row.key === p.owner) continue
        const copy = targets.get(rawEncoding(row.key))
        if (copy !== undefined) { if (!restoreEqual(copy, row.value)) restoreFail(); continue }
        hash = await digestText(JSON.stringify([hash, await digestRaw([row.key, row.value])])); count++; guard.assertCurrent()
      }
    })
    result.push({ store, hash, count })
  }
  return result
}
/** Synchronous requests only in this transaction; no crypto await. Derive the
 * real current counts instead of replaying an additive delta or old snapshot. */
export async function deriveRestoreUsage(tx: IDBPTransaction<unknown, string[], 'readonly' | 'readwrite'>, owner: string): Promise<RestoreUsage> {
  const usage = zeroRestoreUsage(owner)
  for (const store of ['projects', 'documents']) {
    let cursor = await tx.objectStore(store).index('owner').openCursor(owner)
    while (cursor) {
      const row = cursor.value as Record<string, unknown>
      if (row.owner !== owner || !restoreEqual(cursor.primaryKey, row.key) || !['live', 'deleted'].includes(row.state as string)) return restoreFail('format')
      if (row.state === 'live') {
        if (store === 'projects') usage.projects++
        else if (row.kind === 'source') {
          if (!boundedInteger(row.sourceBytes, PROJECT_LIMITS.sourceBytes)) return restoreFail('format')
          usage.documents++; usage.sourceBytes += row.sourceBytes
        } else if (row.kind !== 'text') return restoreFail('format')
      }
      cursor = await cursor.continue()
    }
  }
  if (!validRestoreUsage(usage, owner)) return restoreFail('limit')
  return usage
}
