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

export interface ModelUsage {
  model: string
  count: number
}

export interface QuotaStatus {
  day: string
  limit: number
  total: number
  byModel: ModelUsage[]
}

function todayKey(): string {
  // UTC YYYY-MM-DD — deterministic across Cloudflare regions, no DST drift.
  return new Date().toISOString().slice(0, 10)
}

function getLimit(env: Env): number {
  return parseInt(env.DAILY_QUOTA_PER_USER || '', 10) || DEFAULT_DAILY_LIMIT
}

/**
 * Atomically increment the daily counter for `email` and return whether the
 * caller is under the limit. Also increments a per-model counter so the UI
 * can show a breakdown. Designed to fail open: any D1 error (binding
 * missing, timeout, etc.) logs and allows the request, so a broken quota
 * store never takes the app down.
 */
export async function consumeDailyQuota(
  env: Env,
  email: string,
  model: string
): Promise<QuotaResult> {
  const limit = getLimit(env)

  if (!env.DB) {
    return { allowed: true, count: 0, limit }
  }

  try {
    const day = todayKey()

    // Counter global (utilisé pour appliquer la limite)
    const row = await env.DB.prepare(
      `INSERT INTO quota (email, day, count, updated_at) VALUES (?1, ?2, 1, unixepoch())
       ON CONFLICT (email, day) DO UPDATE SET count = count + 1, updated_at = unixepoch()
       RETURNING count`
    )
      .bind(email, day)
      .first<{ count: number }>()

    // Counter par modèle (utilisé pour l'affichage détaillé dans Paramètres).
    // Table séparée pour éviter une migration risquée de la PK de `quota`.
    // Create-if-missing pour ne pas exiger de migration manuelle côté D1.
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS quota_model (
        email TEXT NOT NULL,
        day TEXT NOT NULL,
        model TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (email, day, model)
      )`
    ).run()

    await env.DB.prepare(
      `INSERT INTO quota_model (email, day, model, count, updated_at) VALUES (?1, ?2, ?3, 1, unixepoch())
       ON CONFLICT (email, day, model) DO UPDATE SET count = count + 1, updated_at = unixepoch()`
    )
      .bind(email, day, model)
      .run()

    const count = row?.count ?? 0
    return { allowed: count <= limit, count, limit }
  } catch (err) {
    // Never block on infra failure — log and let the request through.
    console.error('quota.consumeDailyQuota failed', err)
    return { allowed: true, count: 0, limit }
  }
}

/**
 * Snapshot du quota journalier pour `email` : total global + décomposition
 * par modèle. Utilisé par GET /api/ai/quota/status pour afficher le quota
 * dans Paramètres Arty. N'incrémente rien.
 */
export async function getDailyQuotaStatus(
  env: Env,
  email: string
): Promise<QuotaStatus> {
  const limit = getLimit(env)
  const day = todayKey()

  const empty: QuotaStatus = { day, limit, total: 0, byModel: [] }
  if (!env.DB) return empty

  try {
    const totalRow = await env.DB.prepare(
      `SELECT count FROM quota WHERE email = ?1 AND day = ?2`
    )
      .bind(email, day)
      .first<{ count: number }>()

    // La table quota_model peut ne pas exister encore (1er appel depuis la
    // création). On retourne un résultat vide côté modèles dans ce cas.
    let byModel: ModelUsage[] = []
    try {
      const res = await env.DB.prepare(
        `SELECT model, count FROM quota_model WHERE email = ?1 AND day = ?2 ORDER BY count DESC`
      )
        .bind(email, day)
        .all<ModelUsage>()
      byModel = (res.results ?? []) as ModelUsage[]
    } catch {
      byModel = []
    }

    return {
      day,
      limit,
      total: totalRow?.count ?? 0,
      byModel,
    }
  } catch (err) {
    console.error('quota.getDailyQuotaStatus failed', err)
    return empty
  }
}
