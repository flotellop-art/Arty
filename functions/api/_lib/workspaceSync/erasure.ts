import { verifyGoogleIdentityStrictDetailed } from '../checkAllowedUser'
import { hasSyncSchema, rejectSync, syncSubject, type SyncDatabase } from './common'
import type { Env } from '../../../env'

/** No flag check: turning START off cannot hide already-created vaults. The
 * second strict verification is only needed with the sync schema present;
 * preserve the existing email-only auth/erasure path on older deployments. */
export async function syncAccountIdentity(request: Request, env: Env, email: string, kind: 'google' | 'email-trial') {
  if (kind !== 'google' || !await hasSyncSchema(env.DB)) return null
  const auth = await verifyGoogleIdentityStrictDetailed(request, env.GOOGLE_CLIENT_ID)
  if (auth.status !== 'ok' || auth.identity.email !== email) return rejectSync(503, 'erasure_identity_unavailable')
  return syncSubject(auth.identity.sub)
}
export interface SyncErasureGate { sql: string; values: string[] }

/** All statements share the SAME winning account-erasure ticket. Capturing
 * targets within that transaction prevents a replay from resolving 'current'
 * to a newly recreated vault. Registry rotation invalidates old challenges. */
export function syncRevocationStatements(db: SyncDatabase, subject: string, gate: SyncErasureGate): D1PreparedStatement[] {
  const bind = (sql: string, ...extra: string[]) => db.prepare(sql).bind(subject, ...gate.values, ...extra)
  return [
    bind(`INSERT INTO workspace_sync_subjects_v1(subject_hash,generation)
      SELECT ?1,?6 WHERE (${gate.sql}) ON CONFLICT DO NOTHING`, crypto.randomUUID()),
    bind(`INSERT INTO workspace_sync_erasure_targets_v1(operation_id,vault_id,epoch)
      SELECT ?2,vault_id,epoch FROM workspace_sync_vaults_v1 WHERE subject_hash=?1 AND purged=0
      AND (${gate.sql}) ON CONFLICT DO NOTHING`),
    bind(`UPDATE workspace_sync_vaults_v1 SET revoked=1 WHERE subject_hash=?1 AND (${gate.sql})
      AND EXISTS(SELECT 1 FROM workspace_sync_erasure_targets_v1 t WHERE t.operation_id=?2
        AND t.vault_id=workspace_sync_vaults_v1.vault_id AND t.epoch=workspace_sync_vaults_v1.epoch)`),
    bind(`UPDATE workspace_sync_subjects_v1 SET generation=?6,erasure_ticket=?5 WHERE subject_hash=?1 AND (${gate.sql})`, crypto.randomUUID()),
  ]
}
export const syncErasureCompleteGate = `NOT EXISTS(SELECT 1 FROM workspace_sync_erasure_targets_v1 t
  WHERE t.operation_id=?1 AND NOT EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 v
    WHERE v.vault_id=t.vault_id AND v.epoch=t.epoch AND v.revoked=1 AND v.purged=1))`

/** Legacy callers have no durable operation/incarnation. Once ANY sync vault
 * exists for this subject, require the new protocol without deleting anything.
 * Without a vault, the registry rotation and every DELETE share one SQL gate;
 * enrollment either wins first (no erasure), or its old challenge is revoked. */
export function legacySyncErasureGate(db: SyncDatabase, subject: string) {
  const ticket = crypto.randomUUID(), generation = crypto.randomUUID()
  const sql = `EXISTS(SELECT 1 FROM workspace_sync_subjects_v1 s WHERE s.subject_hash=?2 AND s.erasure_ticket=?3)
    AND NOT EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 WHERE subject_hash=?2)`
  return {
    gate: { sql, values: [subject, ticket] },
    before: [
      db.prepare('INSERT INTO workspace_sync_subjects_v1(subject_hash,generation) VALUES(?1,?2) ON CONFLICT DO NOTHING').bind(subject, generation),
      db.prepare(`UPDATE workspace_sync_subjects_v1 SET generation=?2,erasure_ticket=?3 WHERE subject_hash=?1
        AND NOT EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 WHERE subject_hash=?1)`).bind(subject, generation, ticket),
    ],
    after: db.prepare(`SELECT 1 AS accepted FROM workspace_sync_subjects_v1 WHERE subject_hash=?1 AND erasure_ticket=?2
      AND NOT EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 WHERE subject_hash=?1)`).bind(subject, ticket),
  }
}
