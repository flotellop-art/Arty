import { envelopeFields as fields, parseSyncEnvelopeReference } from '../../../../src/services/workspaceSync/envelopeFormat'
import { SYNC_TRANSPORT_LIMITS, syncHead } from '../../../../src/services/workspaceSync/transportFormat'
import { limitReadableStream } from '../boundedRequestBody'
import { checkedBatch, rejectSync, requireVault, publication, operationReference, objectKey,
  type SyncDatabase, type SyncOperationRow } from './common'

export async function getOperation(db: SyncDatabase, subject: string, vaultId: string, epoch: string, operationId: string) {
  await requireVault(db, subject, vaultId, epoch)
  const row = await db.prepare('SELECT * FROM workspace_sync_operations_v1 WHERE vault_id=? AND epoch=? AND operation_id=?')
    .bind(vaultId, epoch, operationId).first<SyncOperationRow>()
  if (!row) return rejectSync(404, 'operation_unknown')
  return row
}
export function operationStatus(row: SyncOperationRow) {
  return row.status === 'published' ? publication(row) : { protocol: 1, status: row.status, reference: operationReference(row), expectedHead: row.expected_head }
}
export async function reserve(db: SyncDatabase, subject: string, input: unknown) {
  const v = fields(input, ['reference', 'expectedHead']), ref = parseSyncEnvelopeReference(v.reference), expected = syncHead(v.expectedHead)
  if (expected === ref.operationId) return rejectSync(400, 'invalid_predecessor')
  await requireVault(db, subject, ref.vaultId, ref.epoch)
  const ticket = crypto.randomUUID()
  await checkedBatch(db, [
    db.prepare(`INSERT INTO workspace_sync_operations_v1(vault_id,epoch,operation_id,expected_head,sha256,bytes,status,commit_ticket)
      SELECT vault_id,epoch,?4,?5,?6,?7,'reserved',?8 FROM workspace_sync_vaults_v1
      WHERE vault_id=?1 AND epoch=?2 AND subject_hash=?3 AND revoked=0
        AND (SELECT COALESCE(SUM(bytes),0) FROM workspace_sync_vaults_v1 WHERE subject_hash=?3 AND purged=0)+?7<=?9
        AND (SELECT COALESCE(SUM(operations),0) FROM workspace_sync_vaults_v1 WHERE subject_hash=?3 AND purged=0)<?10
        AND (?5 IS NULL OR EXISTS(SELECT 1 FROM workspace_sync_operations_v1 WHERE vault_id=?1 AND operation_id=?5 AND status='published'))
      ON CONFLICT DO NOTHING`).bind(ref.vaultId, ref.epoch, subject, ref.operationId, expected, ref.sha256, ref.bytes,
      ticket, SYNC_TRANSPORT_LIMITS.vaultBytes, SYNC_TRANSPORT_LIMITS.operations),
    db.prepare(`UPDATE workspace_sync_vaults_v1 SET bytes=bytes+?2,operations=operations+1 WHERE vault_id=?1
      AND EXISTS(SELECT 1 FROM workspace_sync_operations_v1 WHERE vault_id=?1 AND operation_id=?3 AND commit_ticket=?4)`)
      .bind(ref.vaultId, ref.bytes, ref.operationId, ticket),
  ])
  const row = await db.prepare('SELECT * FROM workspace_sync_operations_v1 WHERE vault_id=? AND epoch=? AND operation_id=?')
    .bind(ref.vaultId, ref.epoch, ref.operationId).first<SyncOperationRow>()
  if (!row) return rejectSync(409, 'reservation_unavailable')
  if (row.bytes !== ref.bytes || row.sha256 !== ref.sha256 || row.expected_head !== expected) return rejectSync(409, 'operation_mismatch')
  await requireVault(db, subject, ref.vaultId, ref.epoch)
  return operationStatus(row)
}
const hex = (bytes: ArrayBuffer | undefined) => bytes ? Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('') : null
export function attestObject(object: R2Object | null, row: SyncOperationRow) {
  if (!object || object.size !== row.bytes || hex(object.checksums.sha256) !== row.sha256) return rejectSync(409, 'ciphertext_unavailable')
}
export async function upload(db: SyncDatabase, bucket: R2Bucket, subject: string, row: SyncOperationRow, request: Request) {
  if (!request.body || request.headers.get('content-type') !== 'application/octet-stream' || request.headers.has('content-encoding')) return rejectSync(400, 'invalid_upload')
  if (row.status === 'conflict') return rejectSync(409, 'publication_conflict')
  if (row.status === 'published' || row.status === 'uploaded') {
    attestObject(await bucket.head(objectKey(row)), row)
    await requireVault(db, subject, row.vault_id, row.epoch)
    return operationStatus(row)
  }
  const attempt = crypto.randomUUID()
  const admitted = await db.prepare(`INSERT INTO workspace_sync_uploads_v1(attempt_id,vault_id,operation_id)
    SELECT ?1,v.vault_id,?2 FROM workspace_sync_vaults_v1 v
    WHERE v.vault_id=?3 AND v.epoch=?4 AND v.subject_hash=?5 AND v.revoked=0
      AND EXISTS(SELECT 1 FROM workspace_sync_operations_v1 o WHERE o.vault_id=v.vault_id AND o.operation_id=?2 AND o.status='reserved')
      AND (SELECT COUNT(*) FROM workspace_sync_uploads_v1 WHERE vault_id=?3 AND operation_id=?2 AND settled=0)<8`)
    .bind(attempt, row.operation_id, row.vault_id, row.epoch, subject).run()
  if (!admitted.success || admitted.meta.changes !== 1) return rejectSync(409, 'upload_not_admitted')
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30_000)
  const cancel = () => controller.abort(); request.signal.addEventListener('abort', cancel, { once: true })
  if (request.signal.aborted) controller.abort()
  const exact = new FixedLengthStream(row.bytes)
  let received = 0, putResolved = false
  const pumping = limitReadableStream(request.body, row.bytes, n => { received = n }).pipeTo(exact.writable, { signal: controller.signal })
  void pumping.catch(() => {})
  try {
    const object = await bucket.put(objectKey(row), exact.readable, { onlyIf: new Headers({ 'If-None-Match': '*' }), sha256: row.sha256,
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' } })
    putResolved = true
    if (object === null) controller.abort()
    else { await pumping; if (received !== row.bytes) return rejectSync(400, 'upload_length_mismatch') }
    attestObject(object ?? await bucket.head(objectKey(row)), row)
    await requireVault(db, subject, row.vault_id, row.epoch)
    await db.prepare(`UPDATE workspace_sync_operations_v1 SET status='uploaded' WHERE vault_id=?1 AND operation_id=?2 AND status='reserved'
      AND EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 WHERE vault_id=?1 AND epoch=?3 AND subject_hash=?4 AND revoked=0)`)
      .bind(row.vault_id, row.operation_id, row.epoch, subject).run()
    return operationStatus(await getOperation(db, subject, row.vault_id, row.epoch, row.operation_id))
  } finally {
    clearTimeout(timeout); controller.abort(); request.signal.removeEventListener('abort', cancel)
    await pumping.catch(() => {})
    // A rejected/unknown storage call is NOT assumed terminated. Its durable
    // attempt stays unresolved, preventing a false erasure-complete receipt.
    // Only positively settled attempts may leave the inventory. Keep unknown
    // calls forever rather than treating a timeout as erasure evidence. Removing
    // this one settled row also bounds metadata without limiting healthy retries.
    if (putResolved) await db.prepare('DELETE FROM workspace_sync_uploads_v1 WHERE attempt_id=?').bind(attempt).run()
  }
}
export async function commit(db: SyncDatabase, subject: string, row: SyncOperationRow) {
  const ticket = crypto.randomUUID()
  await checkedBatch(db, [
    db.prepare(`UPDATE workspace_sync_operations_v1 SET status='published',commit_ticket=?4,
      sequence=(SELECT sequence+1 FROM workspace_sync_vaults_v1 WHERE vault_id=?1)
      WHERE vault_id=?1 AND epoch=?2 AND operation_id=?3 AND status='uploaded'
        AND EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 v WHERE v.vault_id=?1 AND v.epoch=?2 AND v.subject_hash=?5
          AND v.revoked=0 AND v.head IS workspace_sync_operations_v1.expected_head)`)
      .bind(row.vault_id, row.epoch, row.operation_id, ticket, subject),
    db.prepare(`UPDATE workspace_sync_vaults_v1 SET head=?3,sequence=sequence+1 WHERE vault_id=?1 AND epoch=?2 AND subject_hash=?5 AND revoked=0
      AND EXISTS(SELECT 1 FROM workspace_sync_operations_v1 WHERE vault_id=?1 AND operation_id=?3 AND status='published' AND commit_ticket=?4)`)
      .bind(row.vault_id, row.epoch, row.operation_id, ticket, subject),
    db.prepare(`UPDATE workspace_sync_operations_v1 SET status='conflict' WHERE vault_id=?1 AND epoch=?2 AND operation_id=?3 AND status='uploaded'
      AND EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 v WHERE v.vault_id=?1 AND v.epoch=?2 AND v.subject_hash=?4 AND v.revoked=0
        AND v.head IS NOT workspace_sync_operations_v1.expected_head)`).bind(row.vault_id, row.epoch, row.operation_id, subject),
  ])
  return operationStatus(await getOperation(db, subject, row.vault_id, row.epoch, row.operation_id))
}
