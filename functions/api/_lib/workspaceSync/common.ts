import { verifyGoogleIdentityStrictDetailed } from '../checkAllowedUser'
import { erasureDigest } from '../../../../src/services/accountErasureProtocol'
import type { Env } from '../../../env'
import type { SyncEnvelopeReference } from '../../../../src/services/workspaceSync/envelopeFormat'
import type { SyncPublication } from '../../../../src/services/workspaceSync/transportFormat'

export type SyncDatabase = Pick<D1Database, 'prepare' | 'batch'>
export class SyncHttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
export const rejectSync = (status: number, code: string): never => { throw new SyncHttpError(status, code) }
export function syncReply(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
}
export async function syncSubject(sub: unknown): Promise<string> {
  if (typeof sub !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(sub)) return rejectSync(401, 'identity_unavailable')
  return erasureDigest(JSON.stringify(['arty-workspace-sync-subject-v1', 'google', sub]))
}
export async function requireSyncSubject(request: Request, env: Env): Promise<string> {
  const auth = await verifyGoogleIdentityStrictDetailed(request, env.GOOGLE_CLIENT_ID)
  if (auth.status !== 'ok') return rejectSync(auth.status === 'unavailable' ? 503 : 401, 'identity_unavailable')
  return syncSubject(auth.identity.sub)
}
export async function hasSyncSchema(db: SyncDatabase): Promise<boolean> {
  const expected = new Set(['workspace_sync_subjects_v1', 'workspace_sync_enrollments_v1', 'workspace_sync_vaults_v1',
    'workspace_sync_operations_v1', 'workspace_sync_uploads_v1', 'workspace_sync_erasure_targets_v1'])
  const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'workspace_sync_*'").all<{ name: string }>()
  if (!rows.success) return rejectSync(503, 'sync_schema_unavailable')
  if (rows.results.length === 0) return false
  // A partially restored schema is NOT evidence that sync data never existed.
  if (rows.results.length !== expected.size || rows.results.some(r => !expected.has(r.name))) return rejectSync(503, 'sync_schema_incomplete')
  return true
}
export interface SyncVaultRow { vault_id: string; epoch: string; subject_hash: string; revoked: number; head: string | null; sequence: number; bytes: number; operations: number; purged: number }
export interface SyncOperationRow { vault_id: string; epoch: string; operation_id: string; expected_head: string | null; sha256: string; bytes: number;
  status: 'reserved' | 'uploaded' | 'published' | 'conflict'; sequence: number | null; commit_ticket: string | null; cleaned: number }
export async function requireVault(db: SyncDatabase, subject: string, vault: string, epoch: string): Promise<SyncVaultRow> {
  const row = await db.prepare('SELECT * FROM workspace_sync_vaults_v1 WHERE vault_id=? AND epoch=? AND subject_hash=?').bind(vault, epoch, subject).first<SyncVaultRow>()
  if (!row) return rejectSync(404, 'vault_unavailable')
  if (row.revoked) return rejectSync(410, 'vault_revoked')
  return row
}
export function operationReference(row: SyncOperationRow): SyncEnvelopeReference {
  return { format: 'arty-sync-envelope-ref', version: 1, vaultId: row.vault_id, epoch: row.epoch,
    operationId: row.operation_id, sha256: row.sha256, bytes: row.bytes }
}
export function publication(row: SyncOperationRow): SyncPublication {
  if (row.status !== 'published' || row.sequence === null) return rejectSync(409, 'not_published')
  return { protocol: 1, status: 'published', reference: operationReference(row), previousHead: row.expected_head,
    head: row.operation_id, sequence: row.sequence }
}
export function objectKey(row: Pick<SyncOperationRow, 'vault_id' | 'epoch' | 'operation_id'>) {
  return `workspace-sync-v1/${row.vault_id}/${row.epoch}/${row.operation_id}`
}
export async function checkedBatch(db: SyncDatabase, statements: D1PreparedStatement[]) {
  const results = await db.batch(statements)
  if (results.some(r => !r.success)) rejectSync(503, 'storage_unavailable')
  return results
}
