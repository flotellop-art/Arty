import { envelopeFields as fields, envelopeUUID as uuid, envelopeFail as fail, assertEnvelopeScope } from './envelopeFormat'
import { parseSyncManifest, recordHeads } from './schema'
import { assertSyncManifestRetains, reconcileSyncManifests } from './causal'
import { SYNC_LIMITS, type SyncKind, type SyncManifest } from './types'
import { SYNC_STATE_BYTES } from './localFormat'
import { parseSyncEnrollment, parseSyncPublication, type SyncEnrollment, type SyncPublication } from './transportFormat'
import { copySyncCaptureSelection } from './captureProjection'
import type { SyncCaptureSelection } from './capture'

export interface SyncLocalBinding {
  kind: SyncKind | 'message' | 'group'; localId: string; parentLocalId: string | null; logicalId: string
  presence: 'record' | 'embedded' | 'reference'
}
export interface SyncPrivateStateV1 {
  format: 'arty-sync-private-state'; version: 1
  /** Last acknowledged base, never implicitly advanced by local adoption. */
  base: SyncManifest
  bindings: SyncLocalBinding[]
}
export type SyncRemoteAdmission = { kind: 'create'; challenge: SyncEnrollment } | { kind: 'join'; generation: string }
export interface SyncPrivateStateV2 extends Omit<SyncPrivateStateV1, 'version'> {
  version: 2
  admission: SyncRemoteAdmission
  checkpoint: SyncPublication | null
  selection: SyncCaptureSelection
}
export interface SyncPrivateStateV3 extends Omit<SyncPrivateStateV2, 'version'> {
  version: 3
  /** Physical branch baseline, NOT a freshness witness for live stores. */
  materialized: SyncManifest
  /** Frozen encryption base and publication parent of the durable operation. */
  pendingBase: { base: SyncManifest; checkpoint: SyncPublication | null } | null
}
export type SyncPrivateState = SyncPrivateStateV1 | SyncPrivateStateV2 | SyncPrivateStateV3
const kinds = ['conversation', 'project', 'file', 'project-source', 'project-text', 'message', 'group'] as const
const localId = (v: unknown) => { if (typeof v !== 'string' || !v.length || v.length > 256) return fail('format'); return v }
export function parseSyncPrivateState(input: unknown): SyncPrivateState {
  const version = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'version') : undefined
  const v = version && 'value' in version ? version.value : undefined
  const remote = v === 2 || v === 3
  const root = fields(input, ['format', 'version', 'base', 'bindings', ...(remote ? ['admission', 'checkpoint', 'selection'] : []), ...(v === 3 ? ['materialized', 'pendingBase'] : [])])
  if (root.format !== 'arty-sync-private-state' || ![1, 2, 3].includes(v as number) || !Array.isArray(root.bindings) ||
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
  let result: SyncPrivateState = { format: 'arty-sync-private-state', version: 1, base, bindings }
  if (remote) {
    const kind = root.admission && typeof root.admission === 'object' ? Object.getOwnPropertyDescriptor(root.admission, 'kind') : undefined
    let admission: SyncRemoteAdmission
    if (kind && 'value' in kind && kind.value === 'create') {
      const a = fields(root.admission, ['kind', 'challenge']), challenge = parseSyncEnrollment(a.challenge)
      assertEnvelopeScope(base, challenge); admission = { kind: 'create', challenge }
    } else {
      const a = fields(root.admission, ['kind', 'generation'])
      if (a.kind !== 'join') return fail('format')
      admission = { kind: 'join', generation: uuid(a.generation) }
    }
    const checkpoint = root.checkpoint === null ? null : parseSyncPublication(root.checkpoint)
    if (checkpoint) assertEnvelopeScope(base, checkpoint.reference)
    if ((!checkpoint || checkpoint.sequence === 1) && base.records.length || !checkpoint && admission.kind !== 'create') return fail('base')
    result = { format: 'arty-sync-private-state', version: 2, base, bindings, admission, checkpoint,
      selection: copySyncCaptureSelection(root.selection as SyncCaptureSelection) }
    if (v === 3) {
      const materialized = parseSyncManifest(root.materialized)
      assertEnvelopeScope(base, materialized)
      if (materialized.records.some(record => recordHeads(record).length !== 1)) return fail('base')
      let pendingBase: SyncPrivateStateV3['pendingBase'] = null
      if (root.pendingBase !== null) {
        const pending = fields(root.pendingBase, ['base', 'checkpoint'])
        const origin = parseSyncManifest(pending.base), publication = pending.checkpoint === null ? null : parseSyncPublication(pending.checkpoint)
        assertSyncManifestRetains(origin, base)
        if (publication) assertEnvelopeScope(origin, publication.reference)
        if ((!publication || publication.sequence === 1) && origin.records.length || !publication && admission.kind !== 'create') return fail('base')
        const originSequence = publication?.sequence ?? 0, sequence = checkpoint?.sequence ?? 0
        if (originSequence > sequence || originSequence === sequence &&
          (JSON.stringify(publication) !== JSON.stringify(checkpoint) || JSON.stringify(origin) !== JSON.stringify(base))) return fail('base')
        pendingBase = { base: origin, checkpoint: publication }
      } else {
        if (!checkpoint) return fail('base') // Creation must retain its durable genesis intention.
        assertSyncManifestRetains(materialized, base)
      }
      result = { ...result, version: 3, materialized, pendingBase }
      assertSyncPrivateHead(result, materialized)
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > SYNC_STATE_BYTES) return fail('limit')
  return result
}
/** Exact mapping of a physical branch, not the whole transport DAG in v3. */
export function assertSyncPrivateHead(state: SyncPrivateState, head: SyncManifest) {
  assertEnvelopeScope(state.base, head)
  const bindings = new Map(state.bindings.filter(b => b.presence === 'record').map(b => [b.logicalId, b]))
  if (bindings.size !== head.records.length) return fail('missing')
  for (const record of head.records) if (bindings.get(record.id)?.kind !== record.kind) fail('integrity')
}
/** Call only after opening the actual durable operation against its frozen
 * origin. Parsing private JSON alone cannot prove M is covered by that packet.
 * No pending means every baseline payload is already retained by transport.
 * This proves causal coverage, not freshness or application of physical rows. */
export function syncPrivateLocalHead(state: SyncPrivateState, pendingHead: SyncManifest | null): SyncManifest {
  if (state.version !== 3) {
    const head = pendingHead ?? state.base
    assertSyncPrivateHead(state, head); return head
  }
  if ((state.pendingBase !== null) !== (pendingHead !== null)) return fail('missing')
  const known = pendingHead ? reconcileSyncManifests(state.pendingBase!.base, state.base, pendingHead) : state.base
  assertSyncManifestRetains(state.materialized, known)
  // Unresolved/embedded identities cannot alias a transport record of a
  // different domain, even if that record is not physically materialized.
  const domains = new Map(known.records.map(record => [record.id, record.kind]))
  for (const binding of state.bindings) if (domains.has(binding.logicalId) && domains.get(binding.logicalId) !== binding.kind) fail('integrity')
  assertSyncPrivateHead(state, state.materialized)
  return state.materialized
}

export function syncPrivatePendingBase(state: SyncPrivateState): SyncManifest {
  return state.version === 3 ? state.pendingBase?.base ?? fail('missing') : state.base
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
