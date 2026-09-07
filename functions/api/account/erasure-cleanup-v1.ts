import type { Env } from '../../env'
import { ERASURE_OPERATION_HEADER, ERASURE_CAPABILITY_HEADER, erasureUuid, erasureHash, erasureDigest } from '../../../src/services/accountErasureProtocol'
import { hasSyncSchema, syncReply, objectKey, checkedBatch, type SyncOperationRow } from '../_lib/workspaceSync/common'
import { syncErasureCompleteGate } from '../_lib/workspaceSync/erasure'
import { readRequestTextWithLimit, RequestBodyTooLargeError } from '../_lib/boundedRequestBody'

/** Explicit resumption of a PREVIOUSLY authorized durable deletion. No OAuth,
 * no new erasure target, no START gate; knowledge of an ID alone is insufficient.
 * GET on the original receipt endpoint remains strictly read-only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const operationId = request.headers.get(ERASURE_OPERATION_HEADER), capability = request.headers.get(ERASURE_CAPABILITY_HEADER)
  if (new URL(request.url).search || !erasureUuid(operationId) || !erasureHash(capability)) return syncReply({ error: 'Invalid cleanup request' }, 400)
  if (!env.DB) return syncReply({ error: 'Cleanup unavailable' }, 503)
  try {
    await readRequestTextWithLimit(request, 0)
    const capHash = await erasureDigest(capability)
    const row = await env.DB.prepare('SELECT subject_hash,completed FROM account_erasure_receipts_v1 WHERE operation_id=? AND capability_hash=?')
      .bind(operationId, capHash).first<{ subject_hash: string; completed: number }>()
    if (!row || !erasureHash(row.subject_hash)) return syncReply({ protocol: 1, operationId, status: 'unknown' })
    const reply = (status: 'confirmed' | 'cleanup-pending') => syncReply({ protocol: 1, operationId, status, subjectHash: row.subject_hash })
    if (row.completed === 1) return reply('confirmed')
    if (!await hasSyncSchema(env.DB)) return reply('cleanup-pending')
    const targets = await env.DB.prepare(`SELECT t.vault_id,t.epoch FROM workspace_sync_erasure_targets_v1 t
      JOIN workspace_sync_vaults_v1 v ON v.vault_id=t.vault_id AND v.epoch=t.epoch AND v.revoked=1 AND v.purged=0
      WHERE t.operation_id=? LIMIT 8`).bind(operationId).all<{ vault_id: string; epoch: string }>()
    if (!targets.success) return reply('cleanup-pending')
    for (const target of targets.results) {
      const operations = await env.DB.prepare('SELECT * FROM workspace_sync_operations_v1 WHERE vault_id=? AND epoch=? AND cleaned=0 LIMIT 32')
        .bind(target.vault_id, target.epoch).all<SyncOperationRow>()
      if (!operations.success || operations.results.length && !env.WORKSPACE_SYNC_BUCKET) return reply('cleanup-pending')
      for (const operation of operations.results) {
        const pending = await env.DB.prepare('SELECT 1 FROM workspace_sync_uploads_v1 WHERE vault_id=? AND operation_id=? AND settled=0 LIMIT 1')
          .bind(target.vault_id, operation.operation_id).first()
        if (pending) {
          // An unknown PUT cannot be assumed terminated. Do not launch another
          // writer (even an empty tombstone) that a concurrent cleanup could miss.
          continue
        } else {
          // Revocation prevents new admitted attempts. Every admitted PUT is
          // durably settled, so a completed DELETE cannot race a protocol PUT.
          await env.WORKSPACE_SYNC_BUCKET!.delete(objectKey(operation))
          await env.DB.prepare('UPDATE workspace_sync_operations_v1 SET cleaned=1 WHERE vault_id=? AND epoch=? AND operation_id=?')
            .bind(target.vault_id, target.epoch, operation.operation_id).run()
        }
      }
      await checkedBatch(env.DB, [
        env.DB.prepare(`UPDATE workspace_sync_vaults_v1 SET purged=1,bytes=0,operations=0 WHERE vault_id=?1 AND epoch=?2 AND revoked=1
          AND NOT EXISTS(SELECT 1 FROM workspace_sync_operations_v1 WHERE vault_id=?1 AND cleaned=0)
          AND NOT EXISTS(SELECT 1 FROM workspace_sync_uploads_v1 WHERE vault_id=?1 AND settled=0)`).bind(target.vault_id, target.epoch),
        env.DB.prepare(`DELETE FROM workspace_sync_operations_v1 WHERE vault_id=?1 AND EXISTS(
          SELECT 1 FROM workspace_sync_vaults_v1 WHERE vault_id=?1 AND epoch=?2 AND revoked=1 AND purged=1)`).bind(target.vault_id, target.epoch),
        env.DB.prepare(`DELETE FROM workspace_sync_uploads_v1 WHERE vault_id=?1 AND EXISTS(
          SELECT 1 FROM workspace_sync_vaults_v1 WHERE vault_id=?1 AND epoch=?2 AND revoked=1 AND purged=1)`).bind(target.vault_id, target.epoch),
      ])
    }
    await env.DB.prepare(`UPDATE account_erasure_receipts_v1 SET completed=1 WHERE operation_id=?1 AND capability_hash=?2 AND completed=0
      AND EXISTS(SELECT 1 FROM workspace_sync_erasure_targets_v1 WHERE operation_id=?1) AND (${syncErasureCompleteGate})`).bind(operationId, capHash).run()
    const final = await env.DB.prepare('SELECT completed FROM account_erasure_receipts_v1 WHERE operation_id=? AND capability_hash=?').bind(operationId, capHash).first<{ completed: number }>()
    return reply(final?.completed === 1 ? 'confirmed' : 'cleanup-pending')
  } catch (error) { return syncReply({ error: 'Cleanup not confirmed' }, error instanceof RequestBodyTooLargeError ? 413 : 503) }
}
