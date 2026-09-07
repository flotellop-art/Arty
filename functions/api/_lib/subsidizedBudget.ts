/** Dormant primitive: no production caller, policy provisioning or migration.
 * USD micro-units are an externally VERIFIED upper bound, never wallet prices.
 * One ticket covers exactly ONE provider HTTP attempt. The caller must bind a
 * verified envelope to the actual request; this module cannot price a payload.
 */
const SCOPE = 'arty-subsidized'
const MAX = Number.MAX_SAFE_INTEGER
const ENVELOPE = /^[a-z0-9][a-z0-9._:-]{0,95}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface SubsidizedEnvelope {
  readonly policyRevision: number
  readonly ceilingMicroUsd: number
  readonly envelopeId: string
}
export interface SubsidizedTicket extends SubsidizedEnvelope { readonly id: string }
type Reservation = { status: 'reserved'; ticket: SubsidizedTicket }
  | { status: 'unavailable' | 'budget_exhausted' }
type Dispatch<T> = { status: 'sent'; value: T }
  | { status: 'unavailable' | 'provider_unknown' }
type AttemptRow = { id: string; policy_revision: number; ceiling_micro_usd: number; envelope_id: string }
type PolicyRow = { revision: number; enabled: number; limit_micro_usd: number;
  limit_attempts: number; reserved_micro_usd: number; reserved_attempts: number }

const nonNegative = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
const positive = (n: unknown): n is number => nonNegative(n) && n > 0
function validEnvelope(e: SubsidizedEnvelope): boolean {
  return !!e && positive(e.policyRevision) && positive(e.ceilingMicroUsd)
    && typeof e.envelopeId === 'string' && ENVELOPE.test(e.envelopeId)
}
function validPolicy(p: PolicyRow | undefined, revision: number): p is PolicyRow {
  return !!p && positive(p.revision) && p.revision === revision && p.enabled === 1
    && nonNegative(p.limit_micro_usd) && nonNegative(p.limit_attempts)
    && nonNegative(p.reserved_micro_usd) && p.reserved_micro_usd <= p.limit_micro_usd
    && nonNegative(p.reserved_attempts) && p.reserved_attempts <= p.limit_attempts
}
function matches(row: AttemptRow | undefined, ticket: SubsidizedTicket): boolean {
  return !!row && row.id === ticket.id && row.policy_revision === ticket.policyRevision
    && row.ceiling_micro_usd === ticket.ceilingMicroUsd && row.envelope_id === ticket.envelopeId
}

// Repeat validation in the WRITE predicate: neither a preliminary read nor
// schema constraints alone prove that the current row authorizes a debit.
const VALID_POLICY = `p.scope = '${SCOPE}'
  AND typeof(p.revision) = 'integer' AND p.revision BETWEEN 1 AND ${MAX}
  AND typeof(p.enabled) = 'integer' AND p.enabled = 1
  AND typeof(p.limit_micro_usd) = 'integer' AND p.limit_micro_usd BETWEEN 0 AND ${MAX}
  AND typeof(p.limit_attempts) = 'integer' AND p.limit_attempts BETWEEN 0 AND ${MAX}
  AND typeof(p.reserved_micro_usd) = 'integer' AND p.reserved_micro_usd BETWEEN 0 AND p.limit_micro_usd
  AND typeof(p.reserved_attempts) = 'integer' AND p.reserved_attempts BETWEEN 0 AND p.limit_attempts`

/** No read-then-write, automatic initialization, retry, expiry or refund.
 * The scratch marker exists only inside the transaction. Clearing it at BOTH
 * ends prevents an orphaned old marker from blessing a new, uncharged ticket.
 * A UUID collision is an error (strict INSERT), including at an exhausted cap.
 */
export async function reserveSubsidizedAttempt(
  db: D1Database | undefined, envelope: SubsidizedEnvelope,
): Promise<Reservation> {
  if (!db || !validEnvelope(envelope)) return { status: 'unavailable' }
  const ticket = Object.freeze({ policyRevision: envelope.policyRevision,
    ceilingMicroUsd: envelope.ceilingMicroUsd, envelopeId: envelope.envelopeId,
    id: crypto.randomUUID() })
  const now = Date.now()
  if (!nonNegative(now)) return { status: 'unavailable' }
  try {
    const result = await db.batch([
      db.prepare(`UPDATE subsidized_budget_v1 SET pending_admission_id = NULL WHERE scope = ?`).bind(SCOPE),
      db.prepare(`INSERT INTO subsidized_attempt_v1
        (id, scope, policy_revision, ceiling_micro_usd, envelope_id, state, created_at)
        VALUES (?, ?, ?, ?, ?, 'reserved', ?)`).bind(ticket.id, SCOPE,
        ticket.policyRevision, ticket.ceilingMicroUsd, ticket.envelopeId, now),
      db.prepare(`UPDATE subsidized_budget_v1 AS p SET
        reserved_micro_usd = reserved_micro_usd + ?, reserved_attempts = reserved_attempts + 1,
        pending_admission_id = ? WHERE ${VALID_POLICY} AND p.revision = ?
        AND p.reserved_micro_usd <= p.limit_micro_usd - ?
        AND p.reserved_attempts < p.limit_attempts`).bind(ticket.ceilingMicroUsd,
        ticket.id, ticket.policyRevision, ticket.ceilingMicroUsd),
      db.prepare(`DELETE FROM subsidized_attempt_v1 WHERE id = ? AND NOT EXISTS
        (SELECT 1 FROM subsidized_budget_v1 WHERE scope = ? AND pending_admission_id = ?)`)
        .bind(ticket.id, SCOPE, ticket.id),
      db.prepare(`SELECT id, policy_revision, ceiling_micro_usd, envelope_id
        FROM subsidized_attempt_v1 WHERE id = ? AND scope = ? AND state = 'reserved'`).bind(ticket.id, SCOPE),
      db.prepare(`SELECT revision, enabled, limit_micro_usd, limit_attempts,
        reserved_micro_usd, reserved_attempts FROM subsidized_budget_v1 WHERE scope = ?`).bind(SCOPE),
      db.prepare(`UPDATE subsidized_budget_v1 SET pending_admission_id = NULL WHERE scope = ?`).bind(SCOPE),
    ])
    // Never use an intermediate SELECT if the entire batch ACK is uncertain.
    if (result.length !== 7 || result.some(r => r.success !== true)) return { status: 'unavailable' }
    const policy = result[5].results[0] as PolicyRow | undefined
    if (!validPolicy(policy, ticket.policyRevision)) return { status: 'unavailable' }
    const rows = result[4].results as AttemptRow[]
    if (rows.length === 1 && matches(rows[0], ticket)) return { status: 'reserved', ticket }
    if (rows.length === 0 && (policy.reserved_micro_usd > policy.limit_micro_usd - ticket.ceilingMicroUsd
      || policy.reserved_attempts >= policy.limit_attempts)) return { status: 'budget_exhausted' }
    return { status: 'unavailable' }
  } catch {
    // This might be a committed reservation with a lost ACK. Keep it. No retry.
    return { status: 'unavailable' }
  }
}

/** CAS + invocation stay together: a reusable "permission granted" value is
 * never exported. send must perform exactly one verified provider attempt.
 * Even crash before send, thrown fetch, HTTP 5xx, abort or lost ACK retain the
 * full reserve. "sent" means callback returned, NOT billed amount or success.
 */
export async function dispatchSubsidizedAttempt<T>(
  db: D1Database | undefined, ticket: SubsidizedTicket,
  send: () => Promise<T>, signal?: AbortSignal,
): Promise<Dispatch<T>> {
  if (!db || !validEnvelope(ticket) || typeof ticket.id !== 'string' || !UUID.test(ticket.id) || signal?.aborted)
    return { status: 'unavailable' }
  const now = Date.now()
  if (!nonNegative(now)) return { status: 'unavailable' }
  try {
    const result = await db.prepare(`UPDATE subsidized_attempt_v1 SET state = 'engaged',
      engaged_at = MAX(created_at, ?) WHERE id = ? AND scope = ? AND state = 'reserved'
      AND engaged_at IS NULL AND typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND ${MAX}
      AND typeof(policy_revision) = 'integer' AND typeof(ceiling_micro_usd) = 'integer'
      AND typeof(envelope_id) = 'text'
      AND policy_revision = ? AND ceiling_micro_usd = ? AND envelope_id = ?
      AND EXISTS (SELECT 1 FROM subsidized_budget_v1 AS p WHERE ${VALID_POLICY}
        AND p.revision = ? AND p.reserved_micro_usd >= ? AND p.reserved_attempts >= 1)
      RETURNING id, policy_revision, ceiling_micro_usd, envelope_id`)
      .bind(now, ticket.id, SCOPE, ticket.policyRevision, ticket.ceilingMicroUsd,
        ticket.envelopeId, ticket.policyRevision, ticket.ceilingMicroUsd).all<AttemptRow>()
    if (result.success !== true || result.results.length !== 1 || !matches(result.results[0], ticket)
      || signal?.aborted) return { status: 'unavailable' }
  } catch {
    // A read of an already-engaged row MUST NOT authorize a retry after this.
    return { status: 'unavailable' }
  }
  try { return { status: 'sent', value: await send() } }
  catch { return { status: 'provider_unknown' } }
}
