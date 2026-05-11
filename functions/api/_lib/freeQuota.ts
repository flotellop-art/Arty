// Free daily quotas — 10 Haiku/jour, perpétuel.
// KV-backed, une seule famille (claude-haiku) depuis la dépréciation de
// Mistral Small (mai 2026). Mistral est désormais réservé aux payants —
// Medium est plus coûteux et ne s'inscrit pas dans l'économie du tier free.
//
// Différent du compteur trial (`trial:{email}` à vie 30 messages) : ici
// chaque clé inclut la date `free:{email}:{YYYY-MM-DD}:{family}` et expire
// naturellement (KV TTL 48h pour faciliter le cleanup).

import type { Env } from '../../env'

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
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function freeCounterKey(email: string, family: ModelFamily): string {
  return `free:${email}:${todayKey()}:${family}`
}

export interface FreeQuotaResult {
  allowed: boolean
  remaining: number
  limit: number
  family: ModelFamily | null
}

// Décrémente le compteur free pour la famille de modèle. Retourne `allowed:
// false` si le quota est atteint OU si le modèle n'est pas dans la liste
// autorisée (cas Sonnet/Opus/Gemini Pro pour un free).
export async function consumeFreeDailyQuota(
  env: Env,
  email: string,
  model: string
): Promise<FreeQuotaResult> {
  const family = modelFamilyFor(model)
  if (!family) {
    return { allowed: false, remaining: 0, limit: 0, family: null }
  }
  if (!env.KV) {
    return { allowed: false, remaining: 0, limit: FREE_DAILY_LIMITS[family], family }
  }

  const key = freeCounterKey(email, family)
  const raw = await env.KV.get(key)
  const used = raw === null ? 0 : Math.max(0, parseInt(raw, 10) || 0)
  const limit = FREE_DAILY_LIMITS[family]

  if (used >= limit) {
    return { allowed: false, remaining: 0, limit, family }
  }

  const next = used + 1
  // TTL 48h = la clé expire au pire après-demain, garantit pas de fuite
  // long-terme. La clé du jour suivant sera créée à zéro automatiquement.
  await env.KV.put(key, String(next), { expirationTtl: 48 * 3600 })

  return { allowed: true, remaining: limit - next, limit, family }
}

// Read-only : retourne combien de messages restent à un user free aujourd'hui
// pour chaque famille. Utilisé par /api/subscription/status pour afficher
// le badge dans l'UI sans facturer.
export async function peekFreeDailyRemaining(
  env: Env,
  email: string
): Promise<Record<ModelFamily, number>> {
  const result: Record<ModelFamily, number> = {
    'claude-haiku': FREE_DAILY_LIMITS['claude-haiku'],
  }
  if (!env.KV) return result

  const families: ModelFamily[] = ['claude-haiku']
  for (const family of families) {
    const raw = await env.KV.get(freeCounterKey(email, family))
    const used = raw === null ? 0 : Math.max(0, parseInt(raw, 10) || 0)
    result[family] = Math.max(0, FREE_DAILY_LIMITS[family] - used)
  }
  return result
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
