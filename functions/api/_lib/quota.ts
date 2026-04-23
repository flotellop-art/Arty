import type { Env } from '../../env'

const DEFAULT_DAILY_LIMIT = 50

export interface QuotaResult {
  /** True if the request should proceed. */
  allowed: boolean
  /** Running count for today including this request (0 if skipped on DB error). */
  count: number
  /** Configured limit at evaluation time (for the model). */
  limit: number
}

export interface ModelUsage {
  model: string
  count: number
  /** Limit configured for this model (either per-model override or global default). */
  limit: number
}

export interface QuotaStatus {
  day: string
  /** Global limit (fallback). */
  limit: number
  total: number
  byModel: ModelUsage[]
}

function todayKey(): string {
  // UTC YYYY-MM-DD — deterministic across Cloudflare regions, no DST drift.
  return new Date().toISOString().slice(0, 10)
}

/**
 * Parse per-model limits from DAILY_QUOTA_PER_MODEL (JSON, optional). Any
 * parsing error silently falls back to an empty map — the global default
 * from DAILY_QUOTA_PER_USER (or DEFAULT_DAILY_LIMIT) still applies.
 *
 * Format:
 *   {
 *     "claude-sonnet-4-6": 100,
 *     "whisper-1": 500,
 *     "default": 500
 *   }
 */
function parsePerModelLimits(raw: string | undefined): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        out[k] = Math.floor(v)
      }
    }
    return out
  } catch {
    return {}
  }
}

function getLimitForModel(env: Env, model: string): number {
  const perModel = parsePerModelLimits(env.DAILY_QUOTA_PER_MODEL)
  if (perModel[model] != null) return perModel[model]
  if (perModel['default'] != null) return perModel['default']
  return parseInt(env.DAILY_QUOTA_PER_USER || '', 10) || DEFAULT_DAILY_LIMIT
}

function getGlobalLimit(env: Env): number {
  const perModel = parsePerModelLimits(env.DAILY_QUOTA_PER_MODEL)
  if (perModel['default'] != null) return perModel['default']
  return parseInt(env.DAILY_QUOTA_PER_USER || '', 10) || DEFAULT_DAILY_LIMIT
}

/**
 * Atomically increment the daily counter for `email` and return whether the
 * caller is under the limit. Also increments a per-model counter so the UI
 * can show a breakdown. When `DAILY_QUOTA_PER_MODEL` is set, the limit is
 * applied per-model (each model has its own cap). Otherwise the global
 * limit applies to the sum of all calls for the user that day.
 *
 * Designed to fail open: any D1 error (binding missing, timeout, etc.)
 * logs and allows the request, so a broken quota store never takes the
 * app down.
 */
export async function consumeDailyQuota(
  env: Env,
  email: string,
  model: string
): Promise<QuotaResult> {
  const perModel = parsePerModelLimits(env.DAILY_QUOTA_PER_MODEL)
  const hasPerModel = Object.keys(perModel).length > 0

  const modelLimit = getLimitForModel(env, model)

  if (!env.DB) {
    return { allowed: true, count: 0, limit: modelLimit }
  }

  try {
    const day = todayKey()

    // Counter global (utilisé comme fallback quand DAILY_QUOTA_PER_MODEL
    // n'est pas défini). Incrémenté dans tous les cas pour garder l'historique.
    const globalRow = await env.DB.prepare(
      `INSERT INTO quota (email, day, count, updated_at) VALUES (?1, ?2, 1, unixepoch())
       ON CONFLICT (email, day) DO UPDATE SET count = count + 1, updated_at = unixepoch()
       RETURNING count`
    )
      .bind(email, day)
      .first<{ count: number }>()

    // Counter par modèle — utilisé pour l'affichage détaillé ET (si
    // DAILY_QUOTA_PER_MODEL est set) pour appliquer la limite par modèle.
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

    const modelRow = await env.DB.prepare(
      `INSERT INTO quota_model (email, day, model, count, updated_at) VALUES (?1, ?2, ?3, 1, unixepoch())
       ON CONFLICT (email, day, model) DO UPDATE SET count = count + 1, updated_at = unixepoch()
       RETURNING count`
    )
      .bind(email, day, model)
      .first<{ count: number }>()

    const modelCount = modelRow?.count ?? 0
    const globalCount = globalRow?.count ?? 0

    // Si quota par modèle configuré → appliquer la limite du modèle.
    // Sinon → appliquer l'ancien comportement (limite globale).
    const allowed = hasPerModel
      ? modelCount <= modelLimit
      : globalCount <= modelLimit

    return { allowed, count: hasPerModel ? modelCount : globalCount, limit: modelLimit }
  } catch (err) {
    // Never block on infra failure — log and let the request through.
    console.error('quota.consumeDailyQuota failed', err)
    return { allowed: true, count: 0, limit: modelLimit }
  }
}

/**
 * Snapshot du quota journalier pour `email` : total global + décomposition
 * par modèle (avec la limite de chaque modèle). Utilisé par GET
 * /api/ai/quota/status pour afficher le quota dans Paramètres Arty.
 * N'incrémente rien.
 */
export async function getDailyQuotaStatus(
  env: Env,
  email: string
): Promise<QuotaStatus> {
  const globalLimit = getGlobalLimit(env)
  const day = todayKey()

  const empty: QuotaStatus = { day, limit: globalLimit, total: 0, byModel: [] }
  if (!env.DB) return empty

  try {
    const totalRow = await env.DB.prepare(
      `SELECT count FROM quota WHERE email = ?1 AND day = ?2`
    )
      .bind(email, day)
      .first<{ count: number }>()

    let byModel: ModelUsage[] = []
    try {
      const res = await env.DB.prepare(
        `SELECT model, count FROM quota_model WHERE email = ?1 AND day = ?2 ORDER BY count DESC`
      )
        .bind(email, day)
        .all<{ model: string; count: number }>()
      byModel = (res.results ?? []).map((r) => ({
        model: r.model,
        count: r.count,
        limit: getLimitForModel(env, r.model),
      }))
    } catch {
      byModel = []
    }

    return {
      day,
      limit: globalLimit,
      total: totalRow?.count ?? 0,
      byModel,
    }
  } catch (err) {
    console.error('quota.getDailyQuotaStatus failed', err)
    return empty
  }
}
