import type { Env } from '../../env'
import type { TrialAdmission } from './trialAdmission'

const LIMIT = 30
export type TrialTable = 'trial_usage' | 'email_trial_usage'

/** Negative quota restriction only, following historical OTP normalization.
 * Never use this key for identity, sessions, data, entitlements or wallets.
 * Non-Gmail + mailboxes can conservatively exhaust each other's legacy trial. */
export function trialBenefitKey(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null
  const [localPart, domain] = email.split('@')
  const gmail = domain === 'gmail.com' || domain === 'googlemail.com'
  const local = localPart.split('+', 1)[0]
  const keyLocal = gmail ? local.replace(/\./g, '') : local
  return keyLocal ? `${keyLocal}@${gmail ? 'gmail.com' : domain}` : null
}

// The SAME fixed expression is used for both indexes and lookups. Computed
// from historical rows (including later legacy writes), with no nullable
// backfill column and no second mutable meter to reconcile.
const LOCAL = "substr(lower(trim(email)), 1, instr(trim(email), '@') - 1)"
export const TRIAL_BENEFIT_SQL = `CASE
  WHEN lower(substr(trim(email), instr(trim(email), '@') + 1)) IN ('gmail.com', 'googlemail.com')
  THEN replace(substr(${LOCAL}, 1, instr(${LOCAL} || '+', '+') - 1), '.', '') || '@gmail.com'
  ELSE substr(${LOCAL}, 1, instr(${LOCAL} || '+', '+') - 1) || '@' || lower(substr(trim(email), instr(trim(email), '@') + 1)) END`

function schemaStatements(db: D1Database): D1PreparedStatement[] {
  return (['trial_usage', 'email_trial_usage'] as const).flatMap(table => [
    db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (
      email TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS ${table}_shared_benefit_v1 ON ${table} (${TRIAL_BENEFIT_SQL})`),
  ])
}

// Invalid individual counters never contribute a fabricated zero grant. SUM
// is over both namespaces and all historical restriction aliases, not max(channel).
const SUMMARY = `WITH counters AS (
  SELECT used FROM trial_usage WHERE ${TRIAL_BENEFIT_SQL} = ?2
  UNION ALL
  SELECT used FROM email_trial_usage WHERE ${TRIAL_BENEFIT_SQL} = ?2
), summary AS (
  SELECT COALESCE(SUM(CASE WHEN typeof(used) = 'integer' AND used BETWEEN 0 AND 30
    THEN used ELSE 0 END), 0) AS total,
    COALESCE(MAX(CASE WHEN typeof(used) = 'integer' AND used BETWEEN 0 AND 30
      THEN 0 ELSE 1 END), 0) AS invalid
  FROM counters
)`

function validSummary(row: unknown): row is { total: number; invalid: 0 } {
  return !!row && typeof row === 'object' && 'total' in row && 'invalid' in row
    && row.invalid === 0 && typeof row.total === 'number'
    && Number.isSafeInteger(row.total) && row.total >= 0
}

/** Called only with a verified identity and a non-null restriction key. The caller
 * owns the deadline and sole late compensation. A missing/ambiguous ACK never
 * authorizes upstream or triggers a speculative refund/retry. */
export async function consumeSharedTrialCounter(
  env: Env, email: string, table: TrialTable, key: string,
): Promise<TrialAdmission> {
  if (!env.DB || !key || (table !== 'trial_usage' && table !== 'email_trial_usage') || trialBenefitKey(email) !== key) return { status: 'unavailable' }
  try {
    const db = env.DB
    const result = await db.batch([
      ...schemaStatements(db),
      db.prepare(`${SUMMARY}
        INSERT INTO ${table} (email, used, updated_at)
        SELECT ?1, 1, unixepoch() FROM summary WHERE invalid = 0 AND total < 30
        ON CONFLICT (email) DO UPDATE SET used = ${table}.used + 1, updated_at = unixepoch()
          WHERE typeof(${table}.used) = 'integer' AND ${table}.used BETWEEN 0 AND 29
        RETURNING used AS count`).bind(email, key),
      db.prepare(`${SUMMARY} SELECT total, invalid FROM summary`).bind(email, key),
    ])
    // No self-referential RETURNING subquery: this read is a separate statement
    // in the same D1 transaction, before any competing debit/refund can run.
    if (result.length !== 6 || result.some(r => r.success !== true)) return { status: 'unavailable' }
    const writes = result[4].results
    const rows = result[5].results
    if (!Array.isArray(writes) || !Array.isArray(rows) || rows.length !== 1 || !validSummary(rows[0])) {
      return { status: 'unavailable' }
    }
    const total = rows[0].total
    if (writes.length === 0) return { status: total >= LIMIT ? 'cap_reached' : 'unavailable' }
    const write = writes[0]
    if (writes.length !== 1 || !write || typeof write !== 'object' || !('count' in write)
      || typeof write.count !== 'number' || !Number.isSafeInteger(write.count)
      || write.count < 1 || write.count > total || total > LIMIT) return { status: 'unavailable' }
    return { status: 'consumed', count: total }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Display-only snapshot; never an admission ticket. No counter is created or
 * reset. A valid legacy total above 30 means exhausted, not corrupt. */
export async function readSharedTrialRemaining(env: Env, email: string): Promise<number | null> {
  const key = trialBenefitKey(email)
  if (!env.DB || key === null) return null
  try {
    const db = env.DB
    const result = await db.batch([
      ...schemaStatements(db),
      db.prepare(`${SUMMARY} SELECT total, invalid FROM summary`).bind(email, key),
    ])
    if (result.length !== 5 || result.some(r => r.success !== true)) return null
    const rows = result[4].results
    return Array.isArray(rows) && rows.length === 1 && validSummary(rows[0])
      ? Math.max(0, LIMIT - rows[0].total) : null
  } catch {
    return null
  }
}
