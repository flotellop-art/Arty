import { envelopeFields as fields, envelopeUUID as uuid, envelopeFail as fail, assertEnvelopeScope } from './envelopeFormat'
import { parseSyncManifest } from './schema'
import { SYNC_LIMITS, type SyncKind, type SyncManifest } from './types'
import { SYNC_STATE_BYTES } from './localFormat'

export interface SyncLocalBinding {
  kind: SyncKind | 'message' | 'group'; localId: string; parentLocalId: string | null; logicalId: string
  presence: 'record' | 'embedded' | 'reference'
}
export interface SyncPrivateState {
  format: 'arty-sync-private-state'; version: 1
  /** Last acknowledged base, never implicitly advanced by local adoption. */
  base: SyncManifest
  bindings: SyncLocalBinding[]
}
const kinds = ['conversation', 'project', 'file', 'project-source', 'project-text', 'message', 'group'] as const
const localId = (v: unknown) => { if (typeof v !== 'string' || !v.length || v.length > 256) return fail('format'); return v }
export function parseSyncPrivateState(input: unknown): SyncPrivateState {
  const root = fields(input, ['format', 'version', 'base', 'bindings'])
  if (root.format !== 'arty-sync-private-state' || root.version !== 1 || !Array.isArray(root.bindings) ||
    Object.getPrototypeOf(root.bindings) !== Array.prototype || Object.getOwnPropertySymbols(root.bindings).length) return fail('format')
  if (root.bindings.length > SYNC_LIMITS.revisions || Object.getOwnPropertyNames(root.bindings).length !== root.bindings.length + 1) return fail('limit')
  const base = parseSyncManifest(root.base), keys = new Set<string>(), ids = new Set<string>()
  const bindings: SyncLocalBinding[] = Array.from({ length: root.bindings.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(root.bindings, String(i))
    if (!d?.enumerable || !('value' in d)) return fail('format')
    const b = fields(d.value, ['kind', 'localId', 'parentLocalId', 'logicalId', 'presence'])
    if (!kinds.includes(b.kind as SyncLocalBinding['kind'])) return fail('format')
    const kind = b.kind as SyncLocalBinding['kind'], parented = ['message', 'project-source', 'project-text'].includes(kind)
    const embedded = kind === 'message' || kind === 'group'
    if (b.presence !== 'reference' && b.presence !== (embedded ? 'embedded' : 'record')) return fail('format')
    const binding: SyncLocalBinding = { kind, localId: localId(b.localId), parentLocalId: parented ? localId(b.parentLocalId) : b.parentLocalId === null ? null : fail('format'), logicalId: uuid(b.logicalId), presence: b.presence as SyncLocalBinding['presence'] }
    const key = JSON.stringify([kind, binding.parentLocalId, binding.localId])
    if (keys.has(key) || ids.has(binding.logicalId)) return fail('format')
    keys.add(key); ids.add(binding.logicalId); return binding
  }).sort((a, b) => a.logicalId < b.logicalId ? -1 : 1)
  for (const b of bindings) if (b.parentLocalId !== null && !keys.has(JSON.stringify([b.kind === 'message' ? 'conversation' : 'project', null, b.parentLocalId]))) fail('missing')
  const result: SyncPrivateState = { format: 'arty-sync-private-state', version: 1, base, bindings }
  if (new TextEncoder().encode(JSON.stringify(result)).length > SYNC_STATE_BYTES) return fail('limit')
  return result
}
/** Mapping refers to the frozen proposed head when pending, otherwise base. */
export function assertSyncPrivateHead(state: SyncPrivateState, head: SyncManifest) {
  assertEnvelopeScope(state.base, head)
  const bindings = new Map(state.bindings.filter(b => b.presence === 'record').map(b => [b.logicalId, b]))
  if (bindings.size !== head.records.length) return fail('missing')
  for (const record of head.records) if (bindings.get(record.id)?.kind !== record.kind) fail('integrity')
}
/** Ordinary capture can add mappings or materialize an unresolved reference,
 * never reassign/drop an identity. A future applicator needs its own explicit
 * physical rebind protocol, not this capture path. */
export function assertSyncMappingExtension(before: SyncLocalBinding[], after: SyncLocalBinding[]) {
  const key = (b: SyncLocalBinding) => JSON.stringify([b.kind, b.parentLocalId, b.localId])
  const next = new Map(after.map(b => [key(b), b]))
  for (const old of before) {
    const current = next.get(key(old))
    if (!current || current.logicalId !== old.logicalId || old.presence !== 'reference' && current.presence !== old.presence) fail('integrity')
  }
}
