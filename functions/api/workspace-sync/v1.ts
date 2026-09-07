import type { Env } from '../../env'
import { envelopeUUID as uuid, SyncEnvelopeError } from '../../../src/services/workspaceSync/envelopeFormat'
import { SYNC_TRANSPORT_LIMITS, syncHead } from '../../../src/services/workspaceSync/transportFormat'
import { readRequestTextWithLimit, RequestBodyTooLargeError } from '../_lib/boundedRequestBody'
import { syncReply, requireSyncSubject, requireVault, rejectSync, SyncHttpError, publication, objectKey } from '../_lib/workspaceSync/common'
import { enrollmentChallenge, enroll } from '../_lib/workspaceSync/enrollment'
import { reserve, getOperation, operationStatus, upload, commit, attestObject } from '../_lib/workspaceSync/operations'
import type { SyncOperationRow } from '../_lib/workspaceSync/common'

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url), action = url.searchParams.get('action')
  const starts = request.method === 'POST' && ['challenge', 'enroll', 'reserve'].includes(action ?? '')
  // Missing configuration/OFF refuses new starts before authentication, body
  // consumption or schema access. Previously admitted operations still resume.
  if (starts && env.WORKSPACE_SYNC_START_ENABLED !== 'true') return syncReply({ error: 'Sync starts unavailable' }, 404)
  if (!env.DB || starts && !env.WORKSPACE_SYNC_BUCKET) return syncReply({ error: 'Sync storage unavailable' }, 503)
  try {
    // Without Sessions API, D1 routes every query to primary. A session whose
    // FIRST read is primary would not make later revocation checks current.
    const subject = await requireSyncSubject(request, env), db = env.DB
    if (starts) {
      if (url.searchParams.size !== 1 || request.headers.get('content-type') !== 'application/json' || request.headers.has('content-encoding')) return rejectSync(400, 'invalid_request')
      const body: unknown = JSON.parse(await readRequestTextWithLimit(request, SYNC_TRANSPORT_LIMITS.jsonBytes))
      return syncReply(action === 'challenge' ? await enrollmentChallenge(db, subject, body)
        : action === 'enroll' ? await enroll(db, subject, body) : await reserve(db, subject, body))
    }
    const vaultId = uuid(url.searchParams.get('vaultId')), epoch = uuid(url.searchParams.get('epoch'))
    const vault = await requireVault(db, subject, vaultId, epoch)
    if (action === 'head' && request.method === 'GET' && url.searchParams.size === 3) return syncReply({ protocol: 1, vaultId, epoch, head: vault.head, sequence: vault.sequence })
    if (action === 'chain' && request.method === 'GET' && url.searchParams.size === 5) {
      const head = syncHead(url.searchParams.get('head') === '' ? null : url.searchParams.get('head'))
      const after = Number(url.searchParams.get('after'))
      if (!Number.isSafeInteger(after) || after < 0 || String(after) !== url.searchParams.get('after')) return rejectSync(400, 'invalid_cursor')
      const anchor = head === null ? 0 : (await getOperation(db, subject, vaultId, epoch, head)).sequence
      if (anchor === null || after > anchor) return rejectSync(409, 'chain_unavailable')
      const rows = await db.prepare(`SELECT * FROM workspace_sync_operations_v1 WHERE vault_id=? AND epoch=? AND status='published'
        AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?`).bind(vaultId, epoch, after, anchor, SYNC_TRANSPORT_LIMITS.page).all<SyncOperationRow>()
      if (!rows.success || rows.results.length < Math.min(SYNC_TRANSPORT_LIMITS.page, anchor - after)) return rejectSync(409, 'chain_unavailable')
      const previous = after === 0 ? null : await db.prepare(`SELECT operation_id FROM workspace_sync_operations_v1
        WHERE vault_id=? AND epoch=? AND status='published' AND sequence=?`).bind(vaultId, epoch, after).first<{ operation_id: string }>()
      if (after > 0 && !previous) return rejectSync(409, 'chain_unavailable')
      let predecessor = previous?.operation_id ?? null
      for (let i = 0; i < rows.results.length; i++) {
        const row = rows.results[i]!
        if (row.sequence !== after + i + 1 || row.expected_head !== predecessor) return rejectSync(409, 'chain_unavailable')
        predecessor = row.operation_id
      }
      if (after + rows.results.length === anchor && predecessor !== head) return rejectSync(409, 'chain_unavailable')
      await requireVault(db, subject, vaultId, epoch)
      return syncReply({ protocol: 1, vaultId, epoch, head, after, entries: rows.results.map(publication), next: after + rows.results.length < anchor ? after + rows.results.length : null })
    }
    const operationId = uuid(url.searchParams.get('operationId'))
    if (url.searchParams.size !== 4) return rejectSync(400, 'invalid_request')
    const row = await getOperation(db, subject, vaultId, epoch, operationId)
    if (action === 'status' && request.method === 'GET') return syncReply(operationStatus(row))
    if (action === 'commit' && request.method === 'POST') {
      // workerd may represent an empty POST as a non-null empty stream.
      // Check actual bytes, not the presence of Request.body.
      await readRequestTextWithLimit(request, 0)
      return syncReply(await commit(db, subject, row))
    }
    if (action === 'upload' && request.method === 'PUT') {
      if (!env.WORKSPACE_SYNC_BUCKET) return rejectSync(503, 'storage_unavailable')
      return syncReply(await upload(db, env.WORKSPACE_SYNC_BUCKET, subject, row, request))
    }
    if (action === 'object' && request.method === 'GET' && row.status === 'published') {
      if (!env.WORKSPACE_SYNC_BUCKET) return rejectSync(503, 'storage_unavailable')
      const object = await env.WORKSPACE_SYNC_BUCKET.get(objectKey(row))
      attestObject(object, row)
      await requireVault(db, subject, vaultId, epoch)
      return new Response(object!.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(row.bytes), 'Cache-Control': 'no-store' } })
    }
    return rejectSync(400, 'invalid_request')
  } catch (error) {
    const status = error instanceof SyncHttpError ? error.status : error instanceof RequestBodyTooLargeError ? 413
      : error instanceof SyncEnvelopeError || error instanceof SyntaxError ? 400 : 503
    return syncReply({ error: error instanceof SyncHttpError ? error.code : 'sync_request_unavailable' }, status)
  }
}
