import type { Env } from '../../env'

const DEFAULT_DAILY_LIMIT = 50

export interface QuotaResult {
  /** True if the request should proceed. */
  allowed: boolean
  /** Running count for today including this request (0 if skipped on DB error). */
  count: number
  /** Configured limit at evaluation time. */
  limit: number
}

function todayKey(): string {
  // UTC YYYY-MM-DD — deterministic across Cloudflare regions, no DST drift.
  return new Date().toISOString().slice(0, 10)
}

/**
 * Atomically increment the daily counter for `email` and return whether the
 * caller is under the limit. Designed to fail open: any D1 error (binding
 * missing, timeout, etc.) logs and allows the request, so a broken quota
 * store never takes the app down.
 */
export async function consumeDailyQuota(
  env: Env,
  email: string
): Promise<QuotaResult> {
  const limit = parseInt(env.DAILY_QUOTA_PER_USER || '', 10) || DEFAULT_DAILY_LIMIT

  if (!env.DB) {
    return { allowed: true, count: 0, limit }
  }

  try {
    const day = todayKey()
    // UPSERT + RETURNING gives us the post-increment count in a single round
    // trip. Requires SQLite ≥ 3.35 which D1 ships with.
    const row = await env.DB.prepare(
      `INSERT INTO quota (email, day, count, updated_at) VALUES (?1, ?2, 1, unixepoch())
       ON CONFLICT (email, day) DO UPDATE SET count = count + 1, updated_at = unixepoch()
       RETURNING count`
    )
      .bind(email, day)
      .first<{ count: number }>()

    const count = row?.count ?? 0
    return { allowed: count <= limit, count, limit }
  } catch (err) {
    // Never block on infra failure — log and let the request through.
    console.error('quota.consumeDailyQuota failed', err)
    return { allowed: true, count: 0, limit }
  }
}
