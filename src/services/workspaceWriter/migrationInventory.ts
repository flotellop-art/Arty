import type { IDBPDatabase } from 'idb'
import { legacyStorageKey, workspaceDataKey, isolatedWorkspaceLayout } from './layout'
import { parseLegacyWorkspaceKey, parseOwnedLocalKey } from './localOwnership'

export class WorkspaceMigrationError extends Error {
  constructor(public readonly code: 'disabled' | 'busy' | 'cancelled' | 'unsupported' | 'erasure' | 'changed' | 'collision' | 'missing' | 'storage') {
    super(`workspace_migration_${code}`); this.name = 'WorkspaceMigrationError'
  }
}
export const failMigration = (code: WorkspaceMigrationError['code']): never => { throw new WorkspaceMigrationError(code) }
export const RAW_STORES = ['files', 'projects', 'documents', 'usage', 'meta'] as const
export type RawStore = typeof RAW_STORES[number]
export interface RawRow { key: IDBValidKey; value: unknown }
export interface StoreDigest { store: RawStore; count: number; hash: string }
export interface MigrationPlan {
  version: 1; owners: (string | null)[]; localSource: [string, string][]; localHash: string
  versions: [number, number]; stores: StoreDigest[]
}

/** Deliberate structured-clone subset. Preserve undefined/empty/-0/UTF-16 and
 * all extra data fields; reject exotic values instead of JSON-dropping them.
 * No account/archive-size cap: only a bounded individual record and page. */
export function rawEncoding(value: unknown): string {
  const seen = new Set<object>()
  function encode(v: unknown, depth: number): unknown {
    if (depth > 64) failMigration('unsupported')
    if (v === undefined) return ['undefined']
    if (v === null) return ['null']
    if (typeof v === 'string' || typeof v === 'boolean') return [typeof v, v]
    if (typeof v === 'number') { if (!Number.isFinite(v)) failMigration('unsupported'); return ['number', Object.is(v, -0) ? '-0' : v] }
    if (typeof v !== 'object' || seen.has(v)) return failMigration('unsupported')
    seen.add(v)
    const array = Array.isArray(v)
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype) || Object.getOwnPropertySymbols(v).length) failMigration('unsupported')
    const names = Object.getOwnPropertyNames(v).filter(k => !(array && k === 'length'))
    if (array && (names.length !== (v as unknown[]).length || names.some((k, i) => k !== String(i)))) failMigration('unsupported')
    const entries = names.sort().map(k => {
      const d = Object.getOwnPropertyDescriptor(v, k)!
      if (!d.enumerable || !('value' in d)) return failMigration('unsupported')
      return [k, encode(d.value, depth + 1)]
    })
    return [array ? 'array' : 'object', entries]
  }
  const encoded = JSON.stringify(encode(value, 0))
  if (encoded.length > 32 * 1024 * 1024) failMigration('unsupported')
  return encoded
}
export async function digestText(text: string): Promise<string> {
  // JSON framing escapes unpaired surrogates before UTF-8 encoding.
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('')
}
export const digestRaw = (value: unknown) => digestText(rawEncoding(value))
export function localPairs(): [string, string][] {
  return Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)!])
}
export function parseLegacySlot(key: string) {
  try { return parseLegacyWorkspaceKey(key) } catch { return failMigration('unsupported') }
}
export function assertOwner(owner: unknown): asserts owner is string {
  if (typeof owner !== 'string' || owner.length === 0 || owner.length > 128) failMigration('unsupported')
}
export function validateSessions(pairs: [string, string][]) {
  const map = new Map(pairs), owners = new Set<string>()
  for (const key of ['arty-active-session', 'arty-known-sessions']) {
    if (!map.has(key)) continue
    let value: unknown
    try { value = JSON.parse(map.get(key)!) } catch { return failMigration('unsupported') }
    const list = key === 'arty-known-sessions' ? value : [value]
    if (!Array.isArray(list)) failMigration('unsupported')
    for (const session of list as unknown[]) {
      if (!session || typeof session !== 'object' || !('userId' in session)) failMigration('unsupported')
      const owner = (session as { userId: unknown }).userId
      assertOwner(owner); owners.add(owner)
    }
  }
  return owners
}
/** Historical auth/settings names are ownership hints ONLY. Their values stay
 * at their original addresses and never enter the private-copy journal.
 * Also covers logged-out/orphan owners with no history or assets. */
export function observeLocalOwnerHints(pairs: [string, string][], owners: Set<string | null>) {
  for (const [key] of pairs) {
    try { const part = parseOwnedLocalKey(key); if (part) owners.add(part.owner) }
    catch { failMigration('unsupported') }
  }
}
function validSalt(value: string) {
  try { const v: unknown = JSON.parse(value); return Array.isArray(v) && v.length === 16 && v.every(n => Number.isInteger(n) && n >= 0 && n <= 255) } catch { return false }
}
/** Only the seven exact workspace slots enter the journal, never credentials.
 * Effective global salt/version are copied without promoting a global check.
 * Empty/invalid own salt is explicitly unsupported, not silently repaired. */
export function localTargets(plan: MigrationPlan, generation: string): [string, string][] {
  const layout = isolatedWorkspaceLayout(generation, plan.owners), source = new Map(plan.localSource)
  if (source.size !== plan.localSource.length) failMigration('unsupported')
  const targets = new Map<string, string>()
  for (const [key, value] of plan.localSource) {
    const part = parseLegacySlot(key)
    if (!part || !plan.owners.includes(part.owner) || typeof value !== 'string') failMigration('unsupported')
    targets.set(workspaceDataKey(layout, part!.owner, part!.slot), value)
  }
  for (const owner of plan.owners) {
    const own = source.get(legacyStorageKey(owner, 'crypto-salt'))
    if (own !== undefined && !validSalt(own)) failMigration('unsupported')
    const effective = own ?? source.get('arty-crypto-salt')
    if (effective === undefined || !validSalt(effective)) failMigration('unsupported')
    targets.set(workspaceDataKey(layout, owner, 'crypto-salt'), effective!)
    const version = source.get(legacyStorageKey(owner, 'crypto-version')) ?? source.get('arty-crypto-version')
    if (version !== undefined) targets.set(workspaceDataKey(layout, owner, 'crypto-version'), version)
  }
  return [...targets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
}

export function observeRawOwner(store: RawStore, row: RawRow, owners: Set<string | null>, fence: string) {
  rawEncoding([row.key, row.value]) // validate even otherwise unused fields
  if (store === 'meta') {
    if (Array.isArray(row.key) && row.key[0] === 'erasing') failMigration('erasure') // existence, including falsy receipts
    if (row.key !== 'erasure-fence') failMigration('unsupported')
    if (row.value !== fence) failMigration('erasure')
    return
  }
  const value = row.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) failMigration('unsupported')
  const v = value as Record<string, unknown>
  let owner: unknown = v.owner
  if (store === 'files') {
    if (typeof v.ownerKey !== 'string' || !v.ownerKey.startsWith('arty-') || v.ownerKey === 'arty-anon' || v.fileId !== row.key) failMigration('unsupported')
    owner = (v.ownerKey as string).slice(5)
  }
  assertOwner(owner); owners.add(owner)
  if (store === 'usage') { if (row.key !== owner) failMigration('unsupported') }
  else if (store !== 'files') {
    const expected = store === 'projects' ? [owner, v.id] : [owner, v.projectId, v.id, v.kind]
    if (expected.some(x => typeof x !== 'string' || !x.length) || rawEncoding(expected) !== rawEncoding(row.key) || rawEncoding(row.key) !== rawEncoding(v.key)) failMigration('unsupported')
  }
}

/** Complete store scan (not owner indexes); one cursor page/transaction.
 * Digests and journal writes happen only after that source transaction ends. */
export async function scanRawStore(db: IDBPDatabase | null, store: RawStore, assertCurrent: () => void, signal: AbortSignal,
  consume?: (rows: RawRow[]) => Promise<void>): Promise<StoreDigest> {
  let after: IDBValidKey | undefined, count = 0, hash = await digestText('arty-raw-store-v1')
  if (!db) return { store, count, hash }
  while (true) {
    assertCurrent()
    const tx = db.transaction(store, 'readonly'), rows: RawRow[] = []
    const abort = () => { try { tx.abort() } catch { /* settled */ } }
    signal.addEventListener('abort', abort, { once: true }); void tx.done.catch(() => {})
    try {
      let cursor = await tx.store.openCursor(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true)), bytes = 0
      while (cursor && rows.length < 32 && bytes < 4 * 1024 * 1024) {
        assertCurrent()
        const row = { key: cursor.primaryKey, value: cursor.value }
        bytes += rawEncoding([row.key, row.value]).length
        rows.push(row); after = row.key
        cursor = await cursor.continue()
      }
      await tx.done; assertCurrent()
    } catch (error) { abort(); await tx.done.catch(() => {}); throw error }
    finally { signal.removeEventListener('abort', abort) }
    if (!rows.length) break
    // Row-chain rather than page-chain: independent of pagination boundaries.
    for (const row of rows) { hash = await digestText(JSON.stringify([hash, await digestRaw([row.key, row.value])])); count++; assertCurrent() }
    await consume?.(rows); assertCurrent()
  }
  return { store, count, hash }
}
