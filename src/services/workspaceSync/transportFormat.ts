import { envelopeFields as fields, envelopeUUID as uuid, envelopeScope, parseSyncEnvelopeReference,
  type SyncEnvelopeReference, type SyncVaultScope } from './envelopeFormat'

export const SYNC_TRANSPORT_PATH = '/api/workspace-sync/v1'
export const SYNC_TRANSPORT_LIMITS = Object.freeze({ jsonBytes: 8192, vaultBytes: 128 * 1024 * 1024, operations: 512, page: 32 })
export interface SyncPublication {
  protocol: 1; status: 'published'; reference: Readonly<SyncEnvelopeReference>
  previousHead: string | null; head: string; sequence: number
}
export const syncHead = (value: unknown): string | null => value === null ? null : uuid(value)
export function parseSyncPublication(input: unknown): SyncPublication {
  const v = fields(input, ['protocol', 'status', 'reference', 'previousHead', 'head', 'sequence'])
  if (v.protocol !== 1 || v.status !== 'published' || !Number.isSafeInteger(v.sequence) || (v.sequence as number) < 1) throw new Error('sync_transport_format')
  const reference = parseSyncEnvelopeReference(v.reference), head = uuid(v.head), previousHead = syncHead(v.previousHead)
  if (head !== reference.operationId || head === previousHead) throw new Error('sync_transport_format')
  return { protocol: 1, status: 'published', reference, previousHead, head, sequence: v.sequence as number }
}
export interface SyncEnrollment extends SyncVaultScope { protocol: 1; enrollmentId: string; generation: string }
export function parseSyncEnrollment(input: unknown): SyncEnrollment {
  const v = fields(input, ['protocol', 'enrollmentId', 'generation', 'vaultId', 'epoch'])
  if (v.protocol !== 1) throw new Error('sync_transport_format')
  return { protocol: 1, enrollmentId: uuid(v.enrollmentId), generation: uuid(v.generation),
    ...envelopeScope({ vaultId: v.vaultId, epoch: v.epoch }) }
}
