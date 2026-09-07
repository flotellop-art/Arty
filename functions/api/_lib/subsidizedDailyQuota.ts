import type { Env } from '../../env'
import { consumeCapAtomic } from './atomicQuota'

type DailyAdmission = { status: 'consumed'; count: number } | { status: 'cap_reached' } | { status: 'unavailable' }
function validCount(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= limit
}

/** Fixed table/column pairs, bound data, strict validation BEFORE mutation.
 * Daily caps count attempts: an unknown/late write is NOT replayed or refunded.
 * No provider call is authorized on timeout, unlike the legacy paid-cap policy.
 * This per-account cap is not a global financial budget or proof of uniqueness.
 */
export async function consumeSubsidizedDailyQuota(env: Env, table: 'free_daily_quota' | 'bg_quota',
  email: string, day: string, family: string, limit: number, amount = 1): Promise<DailyAdmission> {
  if (!env.DB || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(amount) || amount < 1) {
    return { status: 'unavailable' }
  }
  if (amount > limit) return { status: 'cap_reached' }
  const column = table === 'free_daily_quota' ? 'family' : 'task'
  const outcome = await consumeCapAtomic(env,
    `INSERT INTO ${table} (email, day, ${column}, count, updated_at)
     VALUES (?1, ?2, ?3, ?4, unixepoch())
     ON CONFLICT (email, day, ${column}) DO UPDATE SET count = count + ?4, updated_at = unixepoch()
       WHERE typeof(${table}.count) = 'integer' AND ${table}.count >= 0 AND ${table}.count + ?4 <= ?5
     RETURNING count`, [email, day, family, amount, limit])
  if (outcome.status === 'fail_open') return { status: 'unavailable' }
  if (outcome.status === 'consumed') return validCount(outcome.count, limit) && outcome.count >= amount
    ? outcome : { status: 'unavailable' }
  // A skipped UPDATE could be corruption, not exhaustion. Never repair/retry.
  try {
    const row = await env.DB.prepare(`SELECT count FROM ${table} WHERE email = ?1 AND day = ?2 AND ${column} = ?3`)
      .bind(email, day, family).first<{ count: unknown }>()
    return row && validCount(row.count, limit) && row.count + amount > limit
      ? { status: 'cap_reached' } : { status: 'unavailable' }
  } catch { return { status: 'unavailable' } }
}
