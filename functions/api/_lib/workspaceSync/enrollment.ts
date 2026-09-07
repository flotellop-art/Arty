import { envelopeFields as fields, envelopeUUID as uuid } from '../../../../src/services/workspaceSync/envelopeFormat'
import { checkedBatch, rejectSync, type SyncDatabase } from './common'

interface Enrollment { subject_hash: string; enrollment_id: string; generation: string; vault_id: string; epoch: string }
/** The challenge is durable and idempotent. Replaying its ID after erasure
 * returns the OLD generation, never fresh authorization to recreate data. */
export async function enrollmentChallenge(db: SyncDatabase, subject: string, body: unknown) {
  const enrollmentId = uuid(fields(body, ['enrollmentId']).enrollmentId)
  await checkedBatch(db, [
    db.prepare('INSERT INTO workspace_sync_subjects_v1(subject_hash,generation) VALUES(?1,?2) ON CONFLICT DO NOTHING').bind(subject, crypto.randomUUID()),
    db.prepare(`INSERT INTO workspace_sync_enrollments_v1(subject_hash,enrollment_id,generation,vault_id,epoch)
      SELECT subject_hash,?2,generation,?3,?4 FROM workspace_sync_subjects_v1 WHERE subject_hash=?1
        AND (SELECT COUNT(*) FROM workspace_sync_enrollments_v1 WHERE subject_hash=?1)<512
      ON CONFLICT DO NOTHING`).bind(subject, enrollmentId, crypto.randomUUID(), crypto.randomUUID()),
  ])
  const row = await db.prepare('SELECT * FROM workspace_sync_enrollments_v1 WHERE subject_hash=? AND enrollment_id=?').bind(subject, enrollmentId).first<Enrollment>()
  if (!row) return rejectSync(503, 'enrollment_unavailable')
  return { protocol: 1, enrollmentId: row.enrollment_id, generation: row.generation, vaultId: row.vault_id, epoch: row.epoch }
}
/** Explicit consent consumes the exact challenge in the current generation.
 * A different active vault is not silently joined or overwritten. */
export async function enroll(db: SyncDatabase, subject: string, body: unknown) {
  const v = fields(body, ['enrollmentId', 'generation', 'consent'])
  const enrollmentId = uuid(v.enrollmentId), generation = uuid(v.generation)
  if (v.consent !== true) return rejectSync(400, 'consent_required')
  await db.prepare(`INSERT INTO workspace_sync_vaults_v1(vault_id,epoch,subject_hash)
    SELECT e.vault_id,e.epoch,e.subject_hash FROM workspace_sync_enrollments_v1 e
    JOIN workspace_sync_subjects_v1 s ON s.subject_hash=e.subject_hash AND s.generation=e.generation
    WHERE e.subject_hash=?1 AND e.enrollment_id=?2 AND e.generation=?3
      AND NOT EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 v WHERE v.subject_hash=?1 AND v.revoked=0)
    ON CONFLICT DO NOTHING`).bind(subject, enrollmentId, generation).run()
  const row = await db.prepare(`SELECT e.* FROM workspace_sync_enrollments_v1 e
    JOIN workspace_sync_subjects_v1 s ON s.subject_hash=e.subject_hash AND s.generation=e.generation
    JOIN workspace_sync_vaults_v1 v ON v.vault_id=e.vault_id AND v.epoch=e.epoch AND v.revoked=0
    WHERE e.subject_hash=?1 AND e.enrollment_id=?2 AND e.generation=?3`).bind(subject, enrollmentId, generation).first<Enrollment>()
  if (!row) return rejectSync(409, 'enrollment_stale_or_conflicting')
  return { protocol: 1, enrollmentId: row.enrollment_id, generation: row.generation, vaultId: row.vault_id, epoch: row.epoch }
}
