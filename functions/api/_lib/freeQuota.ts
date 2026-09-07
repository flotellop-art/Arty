// Free daily quotas — 10 Haiku/jour, perpétuel.
// D1-backed (table `free_daily_quota`), atomique. Migré depuis KV (mai 2026) :
// le pattern KV get→check→put n'était pas atomique (2 requêtes simultanées, ou
// 2 POPs avec KV eventually-consistent, pouvaient dépasser le quota). D1
// (SQLite, primaire unique) sérialise les écritures → upsert conditionnel
// atomique, jamais de dépassement. Voir functions/api/_lib/atomicQuota.ts.
//
// Une seule famille (claude-haiku) depuis la dépréciation de Mistral Small
// (mai 2026). Mistral est désormais réservé aux payants — Medium est plus
// coûteux et ne s'inscrit pas dans l'économie du tier free.

import type { Env } from '../../env'
import { maybeCleanup } from './atomicQuota'
import { consumeSubsidizedDailyQuota } from './subsidizedDailyQuota'

export type ModelFamily = 'claude-haiku'

export const FREE_DAILY_LIMITS: Record<ModelFamily, number> = {
  'claude-haiku': 10,
}

// Familles de modèles que les utilisateurs free peuvent appeler. Tout le
// reste (Sonnet, Opus, Mistral, Gemini, GPT) est verrouillé → 403.
export const FREE_ALLOWED_MODELS: ReadonlyArray<string> = [
  'claude-haiku-4-5-20251001',
]

export function modelFamilyFor(model: string): ModelFamily | null {
  const m = model.toLowerCase()
  if (m.startsWith('claude') && m.includes('haiku')) return 'claude-haiku'
  return null
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

export interface FreeQuotaResult {
  unavailable?: true
  allowed: boolean
  remaining: number
  limit: number
  family: ModelFamily | null
}

async function ensureFreeTable(env: Env): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS free_daily_quota (
        email TEXT NOT NULL,
        day TEXT NOT NULL,
        family TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (email, day, family)
      )`
    ).run()
  } catch (err) {
    console.error('[freeQuota] ensure table failed', err)
  }
}

// Incrémente le compteur free pour la famille de modèle. Retourne `allowed:
// false` si le quota est atteint OU si le modèle n'est pas dans la liste
// autorisée (cas Sonnet/Opus/Gemini Pro pour un free).
//
// Une admission non confirmée est indisponible (503), pas gratuite ni épuisée.
export async function consumeFreeDailyQuota(
  env: Env,
  email: string,
  model: string
): Promise<FreeQuotaResult> {
  const family = modelFamilyFor(model)
  if (!family) {
    return { allowed: false, remaining: 0, limit: 0, family: null }
  }
  const limit = FREE_DAILY_LIMITS[family]
  if (!env.DB) {
    // Sans D1 aucun coût serveur gratuit ne peut être autorisé.
    return { allowed: false, unavailable: true, remaining: 0, limit, family }
  }

  const day = todayKey()
  await ensureFreeTable(env)
  // GC paresseux des jours passés (D1 n'a pas de TTL comme KV).
  await maybeCleanup(env, `DELETE FROM free_daily_quota WHERE day < ?1`, [day])

  const outcome = await consumeSubsidizedDailyQuota(env, 'free_daily_quota', email, day, family, limit)

  if (outcome.status === 'unavailable') {
    return { allowed: false, unavailable: true, remaining: 0, limit, family }
  }
  if (outcome.status === 'cap_reached') {
    return { allowed: false, remaining: 0, limit, family }
  }
  return { allowed: true, remaining: Math.max(0, limit - outcome.count), limit, family }
}

// Read-only : retourne combien de messages restent à un user free aujourd'hui
// pour chaque famille. Utilisé par /api/subscription/status pour afficher
// le badge dans l'UI sans facturer. Ne décrémente rien.
export async function peekFreeDailyRemaining(
  env: Env,
  email: string
): Promise<Record<ModelFamily, number>> {
  const result: Record<ModelFamily, number> = {
    'claude-haiku': FREE_DAILY_LIMITS['claude-haiku'],
  }
  if (!env.DB) return result

  try {
    const day = todayKey()
    const row = await env.DB.prepare(
      `SELECT count FROM free_daily_quota WHERE email = ?1 AND day = ?2 AND family = ?3`
    )
      .bind(email, day, 'claude-haiku')
      .first<{ count: number }>()
    const used = row?.count ?? 0
    result['claude-haiku'] = Math.max(0, FREE_DAILY_LIMITS['claude-haiku'] - used)
  } catch {
    // Table pas encore créée (aucun appel free aujourd'hui) → reste par défaut.
  }
  return result
}

// Quota voix (TTS) gratuit : N lectures/jour pour les users free ET trial.
// Décision produit : la voix du brief matinal est gratuite pour tous, mais
// plafonnée côté gratuit pour borner le coût de la clé OpenAI serveur. Les
// plans payants ne passent pas par ici (voix illimitée). Réutilise la table
// free_daily_quota avec une "famille" dédiée 'tts' (isolée de claude-haiku).
export const TTS_FREE_DAILY_LIMIT = 5

export async function consumeTtsFreeQuota(
  env: Env,
  email: string
): Promise<{ allowed: boolean; remaining: number; unavailable?: true }> {
  if (!env.DB) return { allowed: false, unavailable: true, remaining: 0 }
  const day = todayKey()
  await ensureFreeTable(env)
  await maybeCleanup(env, `DELETE FROM free_daily_quota WHERE day < ?1`, [day])
  const outcome = await consumeSubsidizedDailyQuota(env, 'free_daily_quota', email, day, 'tts', TTS_FREE_DAILY_LIMIT)
  if (outcome.status === 'unavailable') return { allowed: false, unavailable: true, remaining: 0 }
  if (outcome.status === 'cap_reached') return { allowed: false, remaining: 0 }
  return { allowed: true, remaining: Math.max(0, TTS_FREE_DAILY_LIMIT - outcome.count) }
}

// ─────────────────────────────────────────────────────────────────────
// Cap journalier par email sur les endpoints qui dépensent une clé PAYANTE
// du propriétaire hors IA : recherche web (Linkup/Brave) et fetch d'URL
// (Linkup) et reverse-geocoding (Google Maps). Ces endpoints sont ouverts à
// tout compte Google (plan free inclus) → sans cap, un compte peut brûler le
// budget Linkup/Maps du owner (coût réel + déni de service quand le quota
// provider est épuisé).
//
// ⚠️ Ce cap borne l'abus PAR COMPTE (équité + runaway). Il NE borne PAS un
// attaquant qui crée N comptes. Le budget global et l'éligibilité multi-compte
// restent obligatoires (FREE_TRIAL_ABUSE_CDC.md). Aucun plafond provider n'est
// présumé actif ni suffisant sans recette et preuve de configuration.
//
// Réutilise la table free_daily_quota (même mécanisme atomique que le quota
// Haiku/TTS), avec une "famille" dédiée par ressource. Une panne D1 refuse
// l'admission, sans modifier la politique existante des quotas payants.
// ─────────────────────────────────────────────────────────────────────

export type OwnerApiFamily = 'web-search' | 'url-fetch' | 'geo-reverse' | 'osm-trails'

export const OWNER_API_DAILY_LIMITS: Record<OwnerApiFamily, number> = {
  'web-search': 50, // appels Linkup/Brave (1 par source en multi-source)
  'url-fetch': 20, // appels Linkup /v1/fetch (cap client déjà 3/message)
  'geo-reverse': 100, // appels Google Maps Geocoding (cache 1h/110m côté client)
  // Overpass/Nominatim sont gratuits mais bannissent les IP qui les martèlent —
  // l'IP egress Cloudflare est PARTAGÉE : un seul abuseur ferait bannir la
  // feature pour tous (RÈGLE 6, abus infra). Cap large pour un usage réel
  // (une recherche de sentiers = 1-2 appels upstream, cache 24h en amont).
  'osm-trails': 25,
}

/** Vrai si le plan doit être plafonné (non-payant). Les payants (subscription/
 *  pro/vip) brûlent déjà la clé owner via leur accès — non plafonnés ici ; leur
 *  garde anti-runaway est le plafond provider (Option D). */
export function planSubjectToOwnerApiCap(plan: string): boolean {
  return plan === 'free' || plan === 'trial'
}

/**
 * Consomme atomiquement `amount` unités du cap journalier d'une famille de clé
 * owner pour `email` (= email du token Google VÉRIFIÉ, jamais du body). `amount`
 * = nombre d'appels provider RÉELS (recherche multi-source = 1 par source) pour
 * que le cap reflète le coût réel et pas le nombre de requêtes HTTP. Tout-ou-rien :
 * une requête qui dépasserait le cap est refusée (429) au lieu d'être partiellement
 * facturée. Admission refusée temporairement sur incident D1.
 */
export async function consumeOwnerApiQuota(
  env: Env,
  email: string,
  family: OwnerApiFamily,
  amount = 1
): Promise<{ allowed: boolean; remaining: number; limit: number; unavailable?: true }> {
  const limit = OWNER_API_DAILY_LIMITS[family]
  if (!env.DB) return { allowed: false, unavailable: true, remaining: 0, limit }

  const day = todayKey()
  await ensureFreeTable(env)
  await maybeCleanup(env, `DELETE FROM free_daily_quota WHERE day < ?1`, [day])

  const outcome = await consumeSubsidizedDailyQuota(env, 'free_daily_quota', email, day, family, limit, amount)

  if (outcome.status === 'unavailable') return { allowed: false, unavailable: true, remaining: 0, limit }
  if (outcome.status === 'cap_reached') return { allowed: false, remaining: 0, limit }
  return { allowed: true, remaining: Math.max(0, limit - outcome.count), limit }
}

/** 429 générique pour un cap owner-API atteint. Body volontairement générique
 *  (pas de détail provider) — il peut être ré-injecté dans le contexte LLM côté
 *  recherche, et ne doit pas révéler l'état du compte search du owner. */
export function ownerApiLimitResponse(family: OwnerApiFamily, limit: number): Response {
  return Response.json(
    {
      error: 'daily_limit_reached',
      message: `Limite journalière atteinte (${limit}/jour). Réessaie demain ou passe à un plan payant.`,
      family,
      limit,
    },
    { status: 429 }
  )
}

export function freeModelLockedResponse(model: string): Response {
  return Response.json(
    {
      error: 'model_locked',
      message: `Le modèle ${model} est réservé aux abonnés Pro. Choisissez Claude Haiku, ou passez à Pro pour débloquer Sonnet, Opus, Mistral, Gemini et GPT.`,
      lockedModel: model,
    },
    { status: 403 }
  )
}

export function freeQuotaExhaustedResponse(family: ModelFamily, limit: number): Response {
  return Response.json(
    {
      error: 'free_quota_exhausted',
      message: `Quota gratuit Claude Haiku atteint (${limit}/${limit} aujourd'hui). Réessayez demain ou passez à Pro pour un accès illimité.`,
      family,
      limit,
    },
    { status: 429 }
  )
}
