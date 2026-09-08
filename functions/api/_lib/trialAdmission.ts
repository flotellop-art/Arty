import type { Env } from '../../env'
import type { QuotaWaitUntil } from './atomicQuota'

export type TrialAdmission = { status: 'consumed'; count: number } | { status: 'cap_reached' } | { status: 'unavailable' }
const LIMIT = 30
const DEADLINE_MS = 250
function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= LIMIT
}

/** Read-only snapshot for a restrictive continuation, never an admission.
 * Keep MAIN's exact identity and Google/OTP table separation. A failed, corrupt
 * or late read is unknown, not proof of exhaustion or permission to charge. */
export async function readTrialCounterRemaining(env: Env, email: string, table: 'trial_usage' | 'email_trial_usage'): Promise<number | null> {
  if (!env.DB || (table !== 'trial_usage' && table !== 'email_trial_usage')) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = env.DB.prepare(`SELECT used FROM ${table} WHERE email = ?1`).bind(email)
      .first<{ used: unknown }>()
      .then(row => row === null ? LIMIT : validCount(row.used) ? LIMIT - row.used : null)
      .catch(() => null)
    return await Promise.race([pending, new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), DEADLINE_MS)
    })])
  } catch { return null }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

/** Only the two fixed trial tables are accepted. SQL data is always bound.
 * No write replay, no repair of malformed counters, no grant on uncertainty.
 * The deadline covers the increment/readback, not all authentication/setup.
 */
export async function consumeTrialCounter(env: Env, email: string, table: 'trial_usage' | 'email_trial_usage',
  refund: () => Promise<void>, waitUntil?: QuotaWaitUntil): Promise<TrialAdmission> {
  if (!env.DB) return { status: 'unavailable' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = (async (): Promise<TrialAdmission> => {
    try {
      const row = await env.DB.prepare(
        `INSERT INTO ${table} (email, used, updated_at)
         VALUES (?1, 1, unixepoch())
         ON CONFLICT (email) DO UPDATE SET used = used + 1, updated_at = unixepoch()
           WHERE typeof(${table}.used) = 'integer' AND ${table}.used >= 0 AND ${table}.used < ?2
         RETURNING used AS count`,
      ).bind(email, LIMIT).first<{ count: unknown }>()
      if (row !== null) return validCount(row.count) && row.count > 0
        ? { status: 'consumed', count: row.count } : { status: 'unavailable' }
      // A skipped update can mean a full OR corrupt counter. Never call a
      // corrupt/missing/raced-back counter exhausted, and never retry its write.
      const current = await env.DB.prepare(`SELECT used FROM ${table} WHERE email = ?1`).bind(email).first<{ used: unknown }>()
      return current && validCount(current.used) && current.used === LIMIT
        ? { status: 'cap_reached' } : { status: 'unavailable' }
    } catch {
      return { status: 'unavailable' }
    }
  })()
  try {
    const outcome = await Promise.race([pending, new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), DEADLINE_MS)
    })])
    if (outcome !== 'timeout') return outcome
    // Without a background lifetime, wait for the actual result before
    // admission. With waitUntil, refuse now and own the sole late compensation.
    if (!waitUntil) return await pending
    const compensation = pending.then(async late => {
      if (late.status === 'consumed') await refund()
    })
    try { waitUntil(compensation) } catch {
      try { await compensation } catch {
        // An ambiguous refund must not be replayed or change the refusal.
        console.error('[trial] late compensation unavailable')
      }
    }
    return { status: 'unavailable' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
