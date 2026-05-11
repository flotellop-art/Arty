import type { Env } from '../../env'
import {
  parseAllowedEmails,
  trialCounterKey,
  TRIAL_INITIAL_BUDGET,
} from '../_lib/checkAllowedUser'

/**
 * POST /api/trial/init — initialise (ou récupère) le statut "essai gratuit"
 * d'un nouvel utilisateur après son premier sign-in Google.
 *
 * Idempotent : appelé plusieurs fois pour le même email, retourne toujours
 * le plan actuel sans recréer la ligne D1 ni reset le compteur KV.
 *
 * Flow :
 *   1. Lit le token Google depuis `Authorization: Bearer …` (fallback sur
 *      le header `x-google-token` si absent — cohérent avec les proxys IA).
 *   2. Vérifie le token via `oauth2.googleapis.com/tokeninfo` et récupère
 *      l'email vérifié.
 *   3. Si email ∈ ALLOWED_EMAILS → bypass complet, retourne `plan: 'vip'`
 *      sans créer de subscription D1 ni de compteur trial.
 *   4. Sinon, regarde si une ligne `subscriptions` existe déjà :
 *        - trial active  → retourne le compteur courant
 *        - autre plan    → retourne le plan tel quel
 *   5. Sinon (nouveau user) → INSERT 'trial' active + KV `trial:{email}` = 30
 *      → retourne `{ plan: 'trial', trial_messages_remaining: 30 }`.
 */

interface TrialInitResponse {
  plan: 'trial' | 'vip' | 'subscription' | 'pro' | 'free'
  trial_messages_remaining?: number
}

async function verifyTokenViaTokeninfo(token: string, expectedAud: string | undefined): Promise<string | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
    )
    if (!res.ok) return null
    const info = (await res.json()) as {
      email?: string
      email_verified?: string | boolean
      aud?: string
      azp?: string
    }
    const email = info.email?.toLowerCase()
    if (!email) return null
    // H-Plan-2 (audit étape 5) — durcir : email_verified ET aud == NOTRE client.
    // Évite qu'un token Google d'une AUTRE application crée une subscription
    // au nom de cet email dans NOTRE D1.
    const verified = info.email_verified === 'true' || info.email_verified === true
    if (!verified) return null
    if (expectedAud && info.aud && info.aud !== expectedAud && info.azp !== expectedAud) {
      return null
    }
    return email
  } catch {
    return null
  }
}

async function readTrialCounter(env: Env, email: string): Promise<number> {
  if (!env.KV) return 0
  const raw = await env.KV.get(trialCounterKey(email))
  if (raw === null) return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function jsonOk(body: TrialInitResponse): Response {
  return Response.json(body, {
    status: 200,
    // Le middleware `_middleware.ts` réécrit l'origine sur les origins
    // whitelistés ; on garde '*' en fallback pour les requêtes sans
    // Origin (curl, debug). La réponse ne fuit aucune donnée sensible
    // — uniquement le plan public + compteur trial.
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Lire le token depuis Authorization: Bearer ... (priorité), fallback
  // sur le header `x-google-token` que les proxys IA utilisent.
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization')
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i)
  let token = bearerMatch?.[1]?.trim() || ''
  if (!token) {
    token = request.headers.get('x-google-token') || ''
  }

  if (!token) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const email = await verifyTokenViaTokeninfo(token, env.GOOGLE_CLIENT_ID)
  if (!email) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  // VIP bypass — beta testeurs n'ont pas besoin de trial : pas de ligne
  // D1, pas de compteur KV. Idempotent par construction.
  const vipList = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (vipList.includes(email)) {
    return jsonOk({ plan: 'vip' })
  }

  if (!env.DB) {
    return Response.json({ error: 'database_unavailable' }, { status: 503 })
  }

  // Ligne subscription existante ?
  let existing: { plan_type: string; status: string } | null = null
  try {
    existing = await env.DB.prepare(
      `SELECT plan_type, status FROM subscriptions
       WHERE user_email = ?1
       ORDER BY updated_at DESC
       LIMIT 1`
    )
      .bind(email)
      .first<{ plan_type: string; status: string }>()
  } catch (err) {
    console.error('[trial/init] subscriptions lookup failed', err)
    return Response.json({ error: 'database_error' }, { status: 503 })
  }

  if (existing) {
    if (existing.plan_type === 'trial' && existing.status === 'active') {
      const remaining = await readTrialCounter(env, email)
      return jsonOk({ plan: 'trial', trial_messages_remaining: remaining })
    }
    // Plan non-trial déjà en place → retourne tel quel sans créer de trial.
    if (
      existing.plan_type === 'subscription' ||
      existing.plan_type === 'pro' ||
      existing.plan_type === 'vip'
    ) {
      return jsonOk({ plan: existing.plan_type })
    }
    // Plan free ou inconnu — on laisse passer en mode trial nouveau ci-dessous
    // si la ligne existante est un free legacy (cas rare).
  }

  // Nouveau user (ou ligne free legacy) → créer le trial + init compteur.
  try {
    await env.DB.prepare(
      `INSERT INTO subscriptions (user_email, status, plan_type, created_at, updated_at)
       VALUES (?1, 'active', 'trial', datetime('now'), datetime('now'))`
    )
      .bind(email)
      .run()
  } catch (err) {
    console.error('[trial/init] insert failed', err)
    return Response.json({ error: 'database_error' }, { status: 503 })
  }

  if (env.KV) {
    await env.KV.put(trialCounterKey(email), String(TRIAL_INITIAL_BUDGET))
  }

  return jsonOk({
    plan: 'trial',
    trial_messages_remaining: TRIAL_INITIAL_BUDGET,
  })
}
