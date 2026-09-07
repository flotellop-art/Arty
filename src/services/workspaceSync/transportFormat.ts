import { envelopeFields as fields, envelopeUUID as uuid, envelopeScope, parseSyncEnvelopeReference,
  type SyncEnvelopeReference, type SyncVaultScope } from './envelopeFormat'

export const SYNC_TRANSPORT_PATH = '/api/workspace-sync/v1'
export const SYNC_TRANSPORT_LIMITS = Object.freeze({ jsonBytes: 8192, responseBytes: 32768, vaultBytes: 128 * 1024 * 1024, operations: 512, page: 32 })
export interface SyncPublication {
  protocol: 1; status: 'published'; reference: Readonly<SyncEnvelopeReference>
  previousHead: string | null; head: string; sequence: number
}
export const syncHead = (value: unknown): string | null => value === null ? null : uuid(value)
export function parseSyncPublication(input: unknown): SyncPublication {
  const v = fields(input, ['protocol', 'status', 'reference', 'previousHead', 'head', 'sequence'])
  if (v.protocol !== 1 || v.status !== 'published' || !Number.isSafeInteger(v.sequence) || (v.sequence as number) < 1) throw new Error('sync_transport_format')
  const reference = parseSyncEnvelopeReference(v.reference), head = uuid(v.head), previousHead = syncHead(v.previousHead)
  if (head !== reference.operationId || head === previousHead || (v.sequence === 1) !== (previousHead === null)) throw new Error('sync_transport_format')
  return { protocol: 1, status: 'published', reference, previousHead, head, sequence: v.sequence as number }
}

export type SyncOperationStatus = SyncPublication | {
  protocol: 1; status: 'reserved' | 'uploaded' | 'conflict'; reference: Readonly<SyncEnvelopeReference>; expectedHead: string | null
}
export function parseSyncOperationStatus(input: unknown): SyncOperationStatus {
  const status = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'status') : undefined
  if (status && 'value' in status && status.value === 'published') return parseSyncPublication(input)
  const v = fields(input, ['protocol', 'status', 'reference', 'expectedHead'])
  if (v.protocol !== 1 || !['reserved', 'uploaded', 'conflict'].includes(v.status as string)) throw new Error('sync_transport_format')
  const reference = parseSyncEnvelopeReference(v.reference), expectedHead = syncHead(v.expectedHead)
  if (reference.operationId === expectedHead) throw new Error('sync_transport_format')
  return { protocol: 1, status: v.status as 'reserved' | 'uploaded' | 'conflict', reference, expectedHead }
}
export interface SyncHeadSnapshot extends SyncVaultScope { protocol: 1; head: string | null; sequence: number }
export function parseSyncHeadSnapshot(input: unknown): SyncHeadSnapshot {
  const v = fields(input, ['protocol', 'vaultId', 'epoch', 'head', 'sequence']), head = syncHead(v.head)
  if (v.protocol !== 1 || !Number.isSafeInteger(v.sequence) || (v.sequence as number) < 0 ||
    (head === null) !== (v.sequence === 0)) throw new Error('sync_transport_format')
  return { protocol: 1, ...envelopeScope({ vaultId: v.vaultId, epoch: v.epoch }), head, sequence: v.sequence as number }
}
export interface SyncChainPage extends SyncVaultScope {
  protocol: 1; head: string | null; after: number; entries: SyncPublication[]; next: number | null
}
export function parseSyncChainPage(input: unknown): SyncChainPage {
  const v = fields(input, ['protocol', 'vaultId', 'epoch', 'head', 'after', 'entries', 'next'])
  const bound = envelopeScope({ vaultId: v.vaultId, epoch: v.epoch }), head = syncHead(v.head)
  if (v.protocol !== 1 || !Number.isSafeInteger(v.after) || (v.after as number) < 0 || !Array.isArray(v.entries) ||
    Object.getPrototypeOf(v.entries) !== Array.prototype || Object.getOwnPropertySymbols(v.entries).length ||
    Object.getOwnPropertyNames(v.entries).length !== v.entries.length + 1 || v.entries.length > SYNC_TRANSPORT_LIMITS.page) throw new Error('sync_transport_format')
  const after = v.after as number, entries = Array.from({ length: v.entries.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(v.entries, String(i))
    if (!d?.enumerable || !('value' in d)) throw new Error('sync_transport_format')
    const entry = parseSyncPublication(d.value)
    if (entry.reference.vaultId !== bound.vaultId || entry.reference.epoch !== bound.epoch || entry.sequence !== after + i + 1) throw new Error('sync_transport_format')
    return entry
  })
  for (let i = 1; i < entries.length; i++) if (entries[i]!.previousHead !== entries[i - 1]!.head) throw new Error('sync_transport_format')
  if (v.next !== null && (v.next !== after + entries.length || entries.length !== SYNC_TRANSPORT_LIMITS.page)) throw new Error('sync_transport_format')
  if (v.next === null && entries.length && entries.at(-1)!.head !== head || head === null && (after !== 0 || entries.length || v.next !== null)) throw new Error('sync_transport_format')
  return { protocol: 1, ...bound, head, after, entries, next: v.next as number | null }
}
export interface SyncEnrollment extends SyncVaultScope { protocol: 1; enrollmentId: string; generation: string }
export function parseSyncEnrollment(input: unknown): SyncEnrollment {
  const v = fields(input, ['protocol', 'enrollmentId', 'generation', 'vaultId', 'epoch'])
  if (v.protocol !== 1) throw new Error('sync_transport_format')
  return { protocol: 1, enrollmentId: uuid(v.enrollmentId), generation: uuid(v.generation),
    ...envelopeScope({ vaultId: v.vaultId, epoch: v.epoch }) }
}

/** Discovery is an authenticated observation, not enrollment, key validation
 * or a publication ACK. None means no active vault, never no local data. */
export type SyncDiscovery = { protocol: 1; status: 'none' } | {
  protocol: 1; status: 'active'; generation: string; vaultId: string; epoch: string
  head: string | null; sequence: number
}
export function parseSyncDiscovery(input: unknown): SyncDiscovery {
  // Inspect the discriminant as data without invoking an accessor. Each branch
  // still passes through the exact-field, prototype and descriptor grammar.
  const status = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'status') : undefined
  if (status && 'value' in status && status.value === 'none') {
    const v = fields(input, ['protocol', 'status'])
    if (v.protocol !== 1) throw new Error('sync_transport_format')
    return { protocol: 1, status: 'none' }
  }
  const v = fields(input, ['protocol', 'status', 'generation', 'vaultId', 'epoch', 'head', 'sequence'])
  const head = syncHead(v.head)
  if (v.protocol !== 1 || v.status !== 'active' || !Number.isSafeInteger(v.sequence) ||
    (v.sequence as number) < 0 || (head === null) !== (v.sequence === 0)) throw new Error('sync_transport_format')
  return { protocol: 1, status: 'active', generation: uuid(v.generation),
    ...envelopeScope({ vaultId: v.vaultId, epoch: v.epoch }), head, sequence: v.sequence as number }
}
