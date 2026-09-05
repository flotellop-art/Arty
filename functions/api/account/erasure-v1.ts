import type { Env } from '../../env'
import { verifyGoogleUserStrict } from '../_lib/checkAllowedUser'
import { verifyEmailTrialToken } from '../_lib/emailTrial'
import { accountErasureStatements } from '../_lib/accountErasureData'
import { ERASURE_OPERATION_HEADER, ERASURE_CAPABILITY_HEADER, ERASURE_SUBJECT_HEADER,
  erasureDigest, erasureSubject, erasureUuid, erasureHash } from '../../../src/services/accountErasureProtocol'

// Permanent opaque tombstone: expiring/deleting it would let an old POST erase
// newly recreated data. No email, token, capability, content or timestamp.
const SCHEMA = `CREATE TABLE IF NOT EXISTS account_erasure_receipts_v1 (
  operation_id TEXT PRIMARY KEY, capability_hash TEXT NOT NULL UNIQUE,
  subject_hash TEXT NOT NULL, execution_ticket TEXT NOT NULL,
  completed INTEGER NOT NULL CHECK(completed IN (0, 1))
)`
function reply(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } })
}
function credentials(request: Request) {
  const operationId = request.headers.get(ERASURE_OPERATION_HEADER), capability = request.headers.get(ERASURE_CAPABILITY_HEADER)
  if (new URL(request.url).search || !erasureUuid(operationId) || !erasureHash(capability)) return null
  return { operationId, capability }
}

/** Consultation grants no deletion authority; SELECT only, even on a missing
 * table. No auth refresh, token verification, lazy CREATE or cleanup here. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const c = credentials(request)
  if (!c) return reply({ error: 'Invalid erasure request' }, 400)
  if (!env.DB) return reply({ error: 'Erasure status unavailable' }, 503)
  try {
    const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account_erasure_receipts_v1'").first()
    const row = table ? await env.DB.prepare(`SELECT subject_hash, completed FROM account_erasure_receipts_v1
      WHERE operation_id = ?1 AND capability_hash = ?2`).bind(c.operationId, await erasureDigest(c.capability))
      .first<{ subject_hash: string; completed: number }>() : null
    return row?.completed === 1 && erasureHash(row.subject_hash)
      ? reply({ protocol: 1, operationId: c.operationId, status: 'confirmed', subjectHash: row.subject_hash })
      : reply({ protocol: 1, operationId: c.operationId, status: 'unknown' })
  } catch {
    // Never log raw D1 errors: they may include SQL bindings.
    return reply({ error: 'Erasure status unavailable' }, 503)
  }
}

/** Distinct path, never a version header on /delete: an old deployment must
 * not perform a destructive legacy request while ignoring our protocol. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const c = credentials(request), expectedSubject = request.headers.get(ERASURE_SUBJECT_HEADER)
  if (!c || !erasureHash(expectedSubject)) return reply({ error: 'Invalid erasure request' }, 400)
  if (!env.DB) return reply({ error: 'Erasure unavailable' }, 503)
  try {
    const kind = request.headers.has('x-google-token') || request.headers.has('authorization') ? 'google' : 'email-trial'
    const email = kind === 'google' ? await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID) : await verifyEmailTrialToken(request, env)
    if (!email) return reply({ error: 'Unauthorized' }, 401)
    const subjectHash = await erasureSubject(c.capability, kind, email)
    // Bind the captured client identity BEFORE any destructive SQL. These are
    // public request digests, not direct comparisons of raw credentials.
    if (subjectHash !== expectedSubject) return reply({ error: 'Erasure identity mismatch' }, 409)
    const capHash = await erasureDigest(c.capability), ticket = crypto.randomUUID()
    await env.DB.prepare(SCHEMA).run()
    const deletes = await accountErasureStatements(env.DB, email, kind, {
      sql: `EXISTS (SELECT 1 FROM account_erasure_receipts_v1 WHERE operation_id = ?2 AND capability_hash = ?3
        AND subject_hash = ?4 AND execution_ticket = ?5 AND completed = 0)`,
      values: [c.operationId, capHash, subjectHash, ticket],
    })
    const result = await env.DB.batch<{ completed: number }>([
      env.DB.prepare(`INSERT INTO account_erasure_receipts_v1 (operation_id, capability_hash, subject_hash, execution_ticket, completed)
        VALUES (?1, ?2, ?3, ?4, 0) ON CONFLICT DO NOTHING`).bind(c.operationId, capHash, subjectHash, ticket),
      ...deletes,
      env.DB.prepare(`UPDATE account_erasure_receipts_v1 SET completed = 1 WHERE operation_id = ?1 AND capability_hash = ?2
        AND subject_hash = ?3 AND execution_ticket = ?4 AND completed = 0`).bind(c.operationId, capHash, subjectHash, ticket),
      env.DB.prepare(`SELECT completed FROM account_erasure_receipts_v1 WHERE operation_id = ?1
        AND capability_hash = ?2 AND subject_hash = ?3`).bind(c.operationId, capHash, subjectHash),
    ])
    // All deletes AND the receipt commit in one D1 transaction. A duplicate's
    // new ticket cannot win any DELETE, including after account recreation.
    if (result.some(r => !r.success) || result.at(-1)?.results[0]?.completed !== 1) return reply({ error: 'Erasure conflict' }, 409)
    return reply({ protocol: 1, operationId: c.operationId, status: 'confirmed', subjectHash })
  } catch {
    return reply({ error: 'Erasure not confirmed' }, 503)
  }
}
