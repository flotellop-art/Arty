import type { Env } from '../../env'

/**
 * Cap mensuel sur les modèles "premium" pour le plan subscription
 * (500 messages/mois dont 150 Sonnet + 100 GPT-5 + 80 Gemini Pro).
 *
 * Les modèles "standard" (gpt-5-mini, gemini-flash, mistral-*) ne sont
 * jamais cappés — ils tombent sur la voie consumeDailyQuota classique.
 * Quand le cap mensuel est atteint, on regarde si l'user a un Pack Premium
 * acheté (table `premium_packs`) qui peut compenser.
 */

export interface PremiumCapResult {
  allowed: boolean
  /**
   * - 'standard_model' : modèle non-premium, pas de cap
   * - 'monthly_cap'    : sous le cap mensuel
   * - 'premium_pack'   : cap atteint, mais un Pack Premium a été décrémenté
   * - 'cap_reached'    : cap atteint et aucun pack disponible
   */
  reason: 'standard_model' | 'monthly_cap' | 'premium_pack' | 'cap_reached'
  /** Messages premium restants ce mois pour ce modèle (uniquement si reason='monthly_cap'). */
  remaining?: number
}

interface PremiumCapEntry {
  /** Identifiant logique pour le bucket KV (préfixe de modèle). */
  bucket: string
  /** Nombre de messages premium autorisés / mois pour ce bucket. */
  cap: number
}

/**
 * Identifie le bucket premium d'un modèle. Retourne null si standard.
 *
 * - claude-sonnet-* (toute variante) → 150/mois
 * - claude-opus-*                    → 150/mois (partage le bucket sonnet)
 * - gpt-5 strict (pas gpt-5-mini)    → 100/mois
 * - gpt-5.5 (et variantes non-mini)  → 100/mois (bucket gpt5)
 * - gemini-pro* (toute variante)     → 80/mois
 *
 * Standards (retourne null) : gpt-5-mini, gemini-flash*, mistral-*.
 */
function classifyModel(model: string): PremiumCapEntry | null {
  const m = model.toLowerCase()

  // Standards en premier — pour ne pas être attrapé par les patterns premium.
  if (m.startsWith('gpt-5-mini')) return null
  if (m.startsWith('gemini-flash') || m.includes('-flash')) return null
  if (m.startsWith('mistral')) return null

  if (m.startsWith('claude-sonnet') || m.startsWith('claude-opus')) {
    return { bucket: 'claude-sonnet', cap: 150 }
  }
  if (m === 'gpt-5' || m.startsWith('gpt-5.') || m.startsWith('gpt-5-')) {
    // gpt-5-mini déjà filtré plus haut. gpt-5, gpt-5.5, gpt-5-turbo, etc. → 100.
    return { bucket: 'gpt-5', cap: 100 }
  }
  if (m.startsWith('gemini-pro') || m.includes('gemini-1.5-pro') || m.includes('gemini-2-pro')) {
    return { bucket: 'gemini-pro', cap: 80 }
  }

  return null
}

/** YYYY-MM en UTC pour la clé KV — aligné sur quota.ts. */
function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

/**
 * Secondes restantes jusqu'au 1er du mois suivant à 00:00 UTC.
 * Utilisé comme TTL sur la clé KV pour qu'elle expire automatiquement
 * en début de mois (pas besoin de garbage-collect).
 */
function secondsUntilNextMonthUtc(): number {
  const now = new Date()
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  return Math.max(60, Math.floor((next - now.getTime()) / 1000))
}

async function consumePremiumPack(env: Env, email: string): Promise<boolean> {
  if (!env.DB) return false

  try {
    const balance = await env.DB.prepare(
      `SELECT COALESCE(SUM(messages_total - messages_used), 0) AS remaining
       FROM premium_packs
       WHERE user_email = ?1 AND messages_used < messages_total`
    )
      .bind(email)
      .first<{ remaining: number }>()

    if (!balance || (balance.remaining ?? 0) <= 0) return false

    // Décrémente le pack le plus ancien d'abord (FIFO) — on prend juste celui
    // avec le plus petit created_at qui a encore du solde.
    const oldest = await env.DB.prepare(
      `SELECT user_email, order_id FROM premium_packs
       WHERE user_email = ?1 AND messages_used < messages_total
       ORDER BY created_at ASC, order_id ASC
       LIMIT 1`
    )
      .bind(email)
      .first<{ user_email: string; order_id: string }>()

    if (!oldest) return false

    const res = await env.DB.prepare(
      `UPDATE premium_packs
       SET messages_used = messages_used + 1
       WHERE user_email = ?1 AND order_id = ?2 AND messages_used < messages_total`
    )
      .bind(oldest.user_email, oldest.order_id)
      .run()

    // success.meta.changes existe sur D1 — fallback à 1 si non disponible
    // pour ne pas bloquer en cas de variation runtime.
    const changes = (res.meta as { changes?: number } | undefined)?.changes ?? 1
    return changes > 0
  } catch (err) {
    console.error('checkPremiumCap.consumePremiumPack failed', err)
    return false
  }
}

/**
 * Évalue et consomme (si autorisé) le cap premium pour un user/modèle.
 *
 * Comportement :
 *   1. Si le modèle n'est pas premium → allowed=true, reason='standard_model'
 *   2. Sinon, lire le compteur KV `premium_cap:{email}:{YYYY-MM}:{bucket}`
 *      - Si compteur < cap → incrément KV, allowed=true, reason='monthly_cap'
 *      - Si compteur >= cap → tenter de décrémenter un Pack Premium
 *        - Pack consommé → allowed=true, reason='premium_pack'
 *        - Aucun pack    → allowed=false, reason='cap_reached', remaining=0
 *
 * Le KV expire automatiquement le 1er du mois suivant via TTL.
 * Failsafe : en cas d'erreur KV/DB, on autorise (fail-open) — on préfère un
 * léger dépassement à un blocage utilisateur sur incident infra.
 */
export async function checkPremiumCap(
  email: string,
  model: string,
  env: Env
): Promise<PremiumCapResult> {
  const entry = classifyModel(model)
  if (!entry) return { allowed: true, reason: 'standard_model' }

  if (!env.KV) {
    // KV pas configuré : fail-open mais log — l'admin doit binder KV.
    console.error('checkPremiumCap: KV binding missing, failing open')
    return { allowed: true, reason: 'standard_model' }
  }

  const month = currentMonthKey()
  const key = `premium_cap:${email}:${month}:${entry.bucket}`

  let count = 0
  try {
    const raw = await env.KV.get(key)
    count = raw ? parseInt(raw, 10) || 0 : 0
  } catch (err) {
    console.error('checkPremiumCap: KV.get failed, failing open', err)
    return { allowed: true, reason: 'standard_model' }
  }

  if (count >= entry.cap) {
    const packConsumed = await consumePremiumPack(env, email)
    if (packConsumed) return { allowed: true, reason: 'premium_pack' }
    return { allowed: false, reason: 'cap_reached', remaining: 0 }
  }

  try {
    await env.KV.put(key, String(count + 1), {
      expirationTtl: secondsUntilNextMonthUtc(),
    })
  } catch (err) {
    console.error('checkPremiumCap: KV.put failed (still allowing call)', err)
  }

  return {
    allowed: true,
    reason: 'monthly_cap',
    remaining: Math.max(0, entry.cap - count - 1),
  }
}

/**
 * Réponse 429 standardisée à renvoyer aux clients quand le cap est atteint
 * et qu'aucun pack n'est disponible. Le flag `upsell` permet au front
 * d'afficher la modale d'achat d'un Pack Premium.
 */
export function premiumCapReachedResponse(): Response {
  return Response.json(
    {
      error: 'premium_cap_reached',
      message:
        'Tu as atteint ta limite mensuelle pour ce modèle. Achète un Pack Premium pour continuer.',
      upsell: true,
    },
    { status: 429 }
  )
}
