import { envelopeFields as fields, envelopeUUID as uuid } from '../../../../src/services/workspaceSync/envelopeFormat'
import { parseSyncDiscovery, type SyncDiscovery } from '../../../../src/services/workspaceSync/transportFormat'
import { hasSyncSchema, rejectSync, type SyncDatabase } from './common'

interface DiscoveredRow {
  generation: string | null; has_enrollment: number; has_vault: number
  vault_id: string | null; epoch: string | null; head: string | null; sequence: number | null
  purged: number | null; enrollment_id: string | null
}
/** One primary SQL observation binds registry -> enrollment -> active vault.
 * Left joins deliberately retain orphan/inconsistent vaults instead of hiding
 * them behind an inner join. LIMIT 2 bounds a corrupt multi-vault result and
 * refuses it; LIMIT 1 would silently choose an authority. Never creates state. */
export async function discoverVault(db: SyncDatabase, subject: string): Promise<SyncDiscovery> {
  if (!await hasSyncSchema(db)) return rejectSync(503, 'sync_schema_unavailable')
  const rows = await db.prepare(`SELECT s.generation,
    EXISTS(SELECT 1 FROM workspace_sync_enrollments_v1 WHERE subject_hash=?1) AS has_enrollment,
    EXISTS(SELECT 1 FROM workspace_sync_vaults_v1 WHERE subject_hash=?1) AS has_vault,
    v.vault_id,v.epoch,v.head,v.sequence,v.purged,e.enrollment_id
    FROM (SELECT ?1 AS subject_hash) i
    LEFT JOIN workspace_sync_subjects_v1 s ON s.subject_hash=i.subject_hash
    LEFT JOIN workspace_sync_vaults_v1 v ON v.subject_hash=i.subject_hash AND v.revoked=0
    LEFT JOIN workspace_sync_enrollments_v1 e ON e.subject_hash=i.subject_hash
      AND e.vault_id=v.vault_id AND e.epoch=v.epoch AND e.generation=s.generation
    LIMIT 2`).bind(subject).all<DiscoveredRow>()
  if (!rows.success) return rejectSync(503, 'discovery_unavailable')
  if (rows.results.length !== 1) return rejectSync(409, 'discovery_inconsistent')
  const row = rows.results[0]!
  if (row.generation === null && (row.has_enrollment || row.has_vault)) return rejectSync(409, 'discovery_inconsistent')
  try {
    if (row.generation !== null) uuid(row.generation)
    if (row.vault_id === null) return { protocol: 1, status: 'none' }
    if (row.purged !== 0 || row.enrollment_id === null) return rejectSync(409, 'discovery_inconsistent')
    uuid(row.enrollment_id)
    return parseSyncDiscovery({ protocol: 1, status: 'active', generation: row.generation,
      vaultId: row.vault_id, epoch: row.epoch, head: row.head, sequence: row.sequence })
  } catch { return rejectSync(409, 'discovery_inconsistent') }
}

/** Explicit, START-gated confirmation of the discovered incarnation. No new
 * member journal or remote authority is created. Lost response before local
 * adoption requires new confirmation, not an alleged previously admitted join.
 * The response is still not proof of possession of the encryption secret. */
export async function joinVault(db: SyncDatabase, subject: string, body: unknown) {
  const v = fields(body, ['generation', 'vaultId', 'epoch', 'consent'])
  const generation = uuid(v.generation), vaultId = uuid(v.vaultId), epoch = uuid(v.epoch)
  if (v.consent !== true) return rejectSync(400, 'consent_required')
  const observed = await discoverVault(db, subject)
  if (observed.status !== 'active' || observed.generation !== generation || observed.vaultId !== vaultId || observed.epoch !== epoch) {
    return rejectSync(409, 'join_stale_or_conflicting')
  }
  return observed
}
