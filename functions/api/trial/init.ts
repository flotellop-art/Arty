import type { Env } from '../../env'
import {
  parseAllowedEmails,
  ensureTrialTable,
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
 *   5. Sinon (nouveau user) → INSERT 'trial' active. Le compteur D1 `trial_usage`
 *      est créé au 1er message (absence de ligne = 0 consommé = 30 restants).
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

// ─── Attribution first-party pubs (LP Meta, sans pixel) ────────────────────
// Le client (trialClient.ts) attache un JSON `acquisition` optionnel au body :
// utm_* / fbclid / lp capturés par les LPs statiques public/lp/* ou par la SPA.
// Stockage first-touch (INSERT OR IGNORE, une ligne par email) pour mesurer le
// coût par inscription par campagne. Best-effort intégral : aucun échec ici ne
// doit bloquer l'init du trial.

const ACQUISITION_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'lp',
] as const

async function readAcquisitionFromBody(
  request: Request
): Promise<Record<string, string> | null> {
  try {
    const body = (await request.json()) as { acquisition?: Record<string, unknown> } | null
    const acq = body?.acquisition
    if (!acq || typeof acq !== 'object') return null
    const out: Record<string, string> = {}
    for (const field of ACQUISITION_FIELDS) {
      const value = (acq as Record<string, unknown>)[field]
      if (typeof value === 'string' && value) {
        // Même allowlist de caractères que le client (défense en profondeur —
        // le body reste modifiable par n'importe quel appelant authentifié).
        const clean = value.slice(0, 120).replace(/[^\w.\-~:/%+ ]/g, '')
        if (clean) out[field] = clean
      }
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null // body absent ou non-JSON — appelants historiques sans body
  }
}

async function storeAcquisition(
  env: Env,
  email: string,
  acq: Record<string, string>
): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS acquisition (
         email TEXT PRIMARY KEY,
         utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
         utm_content TEXT, utm_term TEXT, fbclid TEXT, lp TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ).run()
    // First-touch : une attribution déjà posée pour cet email n'est JAMAIS
    // écrasée (OR IGNORE sur la clé primaire email).
    await env.DB.prepare(
      `INSERT OR IGNORE INTO acquisition
         (email, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, lp)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
      .bind(
        email,
        acq.utm_source ?? null,
        acq.utm_medium ?? null,
        acq.utm_campaign ?? null,
        acq.utm_content ?? null,
        acq.utm_term ?? null,
        acq.fbclid ?? null,
        acq.lp ?? null
      )
      .run()
  } catch (err) {
    console.error('[trial/init] acquisition store failed', err)
  }
}

async function readTrialRemaining(env: Env, email: string): Promise<number> {
  if (!env.DB) return TRIAL_INITIAL_BUDGET
  try {
    await ensureTrialTable(env)
    const row = await env.DB.prepare(
      `SELECT used FROM trial_usage WHERE email = ?1`
    )
      .bind(email)
      .first<{ used: number }>()
    const used = row?.used ?? 0
    // C13 — clamp explicite des DEUX bornes : jamais < 0 (déjà le cas) NI >
    // budget (protège contre un `used` négatif/corrompu qui gonflerait le
    // restant côté serveur). Le client était déjà borné.
    return Math.min(TRIAL_INITIAL_BUDGET, Math.max(0, TRIAL_INITIAL_BUDGET - used))
  } catch (err) {
    console.error('[trial/init] read remaining failed', err)
    return TRIAL_INITIAL_BUDGET
  }
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

  // Attribution pub éventuelle — après vérification du token (l'email est
  // prouvé), hors chemin VIP (beta testeurs ≠ trafic payant), best-effort.
  const acquisition = await readAcquisitionFromBody(request)
  if (acquisition) {
    await storeAcquisition(env, email, acquisition)
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
      const remaining = await readTrialRemaining(env, email)
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
  // `ON CONFLICT DO NOTHING` (générique, sans cible) : ne lève JAMAIS, que la
  // contrainte d'unicité sur user_email existe (migration 0005) ou pas — évite
  // le 503 sur reconnexion d'un user ayant déjà une ligne (réconciliation
  // 15 juin). created_at/updated_at en datetime('now') = TEXT, cohérent prod.
  try {
    await env.DB.prepare(
      `INSERT INTO subscriptions (user_email, status, plan_type, created_at, updated_at)
       VALUES (?1, 'active', 'trial', datetime('now'), datetime('now'))
       ON CONFLICT DO NOTHING`
    )
      .bind(email)
      .run()
  } catch (err) {
    console.error('[trial/init] insert failed', err)
    return Response.json({ error: 'database_error' }, { status: 503 })
  }

  // Pas d'init de compteur : la table D1 trial_usage est créée au 1er message
  // (absence de ligne = 0 consommé = budget plein).
  return jsonOk({
    plan: 'trial',
    trial_messages_remaining: TRIAL_INITIAL_BUDGET,
  })
}
