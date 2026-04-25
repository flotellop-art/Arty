import type { Env } from '../../env'
import type { UsageTokens } from './pricing'
import { computeCostMicroUsd } from './pricing'

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
  /** Input tokens consumed today (summed across all calls). 0 if tracking unavailable. */
  inputTokens: number
  /** Output tokens produced today. 0 if tracking unavailable. */
  outputTokens: number
  /** Cache-read tokens (prompt caching) — 10x cheaper than input. 0 if N/A. */
  cacheReadTokens: number
  /** Cache-creation tokens — written to the cache for reuse. 0 if N/A. */
  cacheCreationTokens: number
  /** Whisper audio seconds transcribed today. 0 if N/A. */
  audioSeconds: number
  /** Real cost in USD — computed server-side from token pricing, not an estimate. */
  costUsd: number
}

export interface QuotaStatus {
  day: string
  /** Global limit (fallback). */
  limit: number
  total: number
  byModel: ModelUsage[]
}

export interface MonthlyModelUsage {
  model: string
  count: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  audioSeconds: number
  costUsd: number
}

export interface MonthlyQuotaStatus {
  /** YYYY-MM in UTC. */
  month: string
  byModel: MonthlyModelUsage[]
}

function todayKey(): string {
  // UTC YYYY-MM-DD — deterministic across Cloudflare regions, no DST drift.
  return new Date().toISOString().slice(0, 10)
}

function currentMonthKey(): string {
  // UTC YYYY-MM — dérive du jour pour rester aligné avec todayKey().
  return new Date().toISOString().slice(0, 7)
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
    // Les colonnes tokens/coût sont ajoutées pour le tracking précis (1.0.38).
    // CREATE IF NOT EXISTS est idempotent ; pour les BDs existantes on fait
    // aussi des ALTER TABLE silencieux (ignore si la colonne existe déjà).
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS quota_model (
        email TEXT NOT NULL,
        day TEXT NOT NULL,
        model TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        audio_seconds INTEGER NOT NULL DEFAULT 0,
        cost_usd_micro INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (email, day, model)
      )`
    ).run()

    // Migration silencieuse : ALTER TABLE ADD COLUMN pour les BDs qui
    // existaient avant 1.0.38 avec seulement (count, updated_at). SQLite
    // rejette l'ALTER si la colonne existe déjà — on ignore l'erreur.
    for (const col of [
      'input_tokens INTEGER NOT NULL DEFAULT 0',
      'output_tokens INTEGER NOT NULL DEFAULT 0',
      'cache_read_tokens INTEGER NOT NULL DEFAULT 0',
      'cache_creation_tokens INTEGER NOT NULL DEFAULT 0',
      'audio_seconds INTEGER NOT NULL DEFAULT 0',
      'cost_usd_micro INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        await env.DB.prepare(`ALTER TABLE quota_model ADD COLUMN ${col}`).run()
      } catch {
        // column already exists → ignore
      }
    }

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
        `SELECT model, count,
                COALESCE(input_tokens, 0) AS input_tokens,
                COALESCE(output_tokens, 0) AS output_tokens,
                COALESCE(cache_read_tokens, 0) AS cache_read_tokens,
                COALESCE(cache_creation_tokens, 0) AS cache_creation_tokens,
                COALESCE(audio_seconds, 0) AS audio_seconds,
                COALESCE(cost_usd_micro, 0) AS cost_usd_micro
         FROM quota_model WHERE email = ?1 AND day = ?2 ORDER BY count DESC`
      )
        .bind(email, day)
        .all<{
          model: string
          count: number
          input_tokens: number
          output_tokens: number
          cache_read_tokens: number
          cache_creation_tokens: number
          audio_seconds: number
          cost_usd_micro: number
        }>()
      byModel = (res.results ?? []).map((r) => ({
        model: r.model,
        count: r.count,
        limit: getLimitForModel(env, r.model),
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheCreationTokens: r.cache_creation_tokens,
        audioSeconds: r.audio_seconds,
        costUsd: r.cost_usd_micro / 1_000_000,
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

/**
 * Snapshot mensuel pour `email` — somme `quota_model` sur tous les jours du
 * mois courant (UTC), groupé par modèle. Utilisé par GET /api/ai/quota/month
 * pour alimenter le badge $$ "coût ce mois" dans la TopBar. N'incrémente rien.
 */
export async function getMonthlyQuotaStatus(
  env: Env,
  email: string
): Promise<MonthlyQuotaStatus> {
  const month = currentMonthKey()
  const empty: MonthlyQuotaStatus = { month, byModel: [] }
  if (!env.DB) return empty

  try {
    const res = await env.DB.prepare(
      `SELECT model,
              SUM(count) AS calls,
              SUM(COALESCE(input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(output_tokens, 0)) AS output_tokens,
              SUM(COALESCE(cache_read_tokens, 0)) AS cache_read_tokens,
              SUM(COALESCE(cache_creation_tokens, 0)) AS cache_creation_tokens,
              SUM(COALESCE(audio_seconds, 0)) AS audio_seconds,
              SUM(COALESCE(cost_usd_micro, 0)) AS cost_usd_micro
       FROM quota_model
       WHERE email = ?1 AND day LIKE ?2
       GROUP BY model
       ORDER BY cost_usd_micro DESC`
    )
      .bind(email, `${month}-%`)
      .all<{
        model: string
        calls: number
        input_tokens: number
        output_tokens: number
        cache_read_tokens: number
        cache_creation_tokens: number
        audio_seconds: number
        cost_usd_micro: number
      }>()

    const byModel: MonthlyModelUsage[] = (res.results ?? []).map((r) => ({
      model: r.model,
      count: r.calls ?? 0,
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      cacheReadTokens: r.cache_read_tokens ?? 0,
      cacheCreationTokens: r.cache_creation_tokens ?? 0,
      audioSeconds: r.audio_seconds ?? 0,
      costUsd: (r.cost_usd_micro ?? 0) / 1_000_000,
    }))

    return { month, byModel }
  } catch (err) {
    console.error('quota.getMonthlyQuotaStatus failed', err)
    return empty
  }
}

/**
 * Enregistre les tokens consommés par un appel et met à jour le coût en
 * micro-USD. Appelé depuis les proxies IA après consumeDailyQuota() a déjà
 * incrémenté le compteur, une fois que le stream de la réponse est entièrement
 * parsé via trackUsage.ts.
 *
 * Idempotent pour les erreurs D1 : en cas d'échec, on log et on ignore (le
 * compteur reste correct, seule la précision du coût est affectée).
 */
export async function recordUsage(
  env: Env,
  email: string,
  model: string,
  usage: UsageTokens
): Promise<void> {
  if (!env.DB) return

  const cost = computeCostMicroUsd(model, usage)
  const day = todayKey()

  try {
    await env.DB.prepare(
      `UPDATE quota_model
       SET input_tokens = input_tokens + ?1,
           output_tokens = output_tokens + ?2,
           cache_read_tokens = cache_read_tokens + ?3,
           cache_creation_tokens = cache_creation_tokens + ?4,
           audio_seconds = audio_seconds + ?5,
           cost_usd_micro = cost_usd_micro + ?6,
           updated_at = unixepoch()
       WHERE email = ?7 AND day = ?8 AND model = ?9`
    )
      .bind(
        Math.max(0, Math.round(usage.inputTokens)),
        Math.max(0, Math.round(usage.outputTokens)),
        Math.max(0, Math.round(usage.cacheReadTokens)),
        Math.max(0, Math.round(usage.cacheCreationTokens)),
        Math.max(0, Math.round(usage.audioSeconds)),
        Math.max(0, Math.round(cost)),
        email,
        day,
        model
      )
      .run()
  } catch (err) {
    console.error('quota.recordUsage failed', err)
  }
}
