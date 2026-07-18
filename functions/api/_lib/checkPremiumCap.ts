import type { Env } from '../../env'
import { consumeCapAtomic, maybeCleanup } from './atomicQuota'
import { hasKnownPricing } from './pricing'

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
  /** Messages premium restants ce mois pour ce bucket (0 si cap atteint). */
  remaining?: number
  /** Bucket premium concerné — absent pour les modèles standard. */
  bucket?: string
  /** Cap mensuel du bucket — absent pour les modèles standard. */
  cap?: number
}

/**
 * Caps mensuels par bucket premium (plan subscription). Source de vérité
 * unique — consommée aussi par /api/subscription/status pour exposer les
 * compteurs au client (P0.6 du plan d'action concurrentiel).
 */
export const PREMIUM_BUCKET_CAPS: Record<string, number> = {
  'claude-sonnet': 150,
  'gpt-5': 100,
  'gemini-pro': 80,
  'unknown-model': 80,
  // P1.3 — génération d'images. Cap volontairement bas (chaque image = coût
  // fixe ~$0.04) ; tunable après une vigie d'un mois.
  'gpt-image': 10,
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
 * - gpt-5.x non-mini (5.5, 5.6-terra…) → 100/mois (bucket gpt5)
 * - gemini-pro* (toute variante)     → 80/mois
 *
 * Standards (retourne null) : gpt-5-mini, gemini-flash*, mistral-*.
 */
export function classifyPremiumModel(model: string): PremiumCapEntry | null {
  const m = model.toLowerCase()

  // Génération d'images (P1.3) — bucket dédié, avant les patterns gpt-*.
  // Les modèles FLUX (P1.3-FLUX) partagent le MÊME bucket : « 10 images/mois »
  // toutes images confondues, quel que soit le provider.
  if (m.startsWith('gpt-image') || m.startsWith('flux-') || m.startsWith('flux.')) {
    return { bucket: 'gpt-image', cap: PREMIUM_BUCKET_CAPS['gpt-image']! }
  }

  // Standards seulement s'ils figurent exactement au catalogue financier.
  // Une variante nouvelle/inventée ne doit jamais hériter d'un tarif mini ni
  // contourner les caps par simple suffixe.
  if (hasKnownPricing(m)) {
    if (m.startsWith('gpt-5') && (m.includes('-mini') || m.includes('-nano'))) return null
    if (m.startsWith('gemini-flash') || m.includes('-flash')) return null
    if (m.startsWith('mistral') || m.startsWith('codestral')) return null
    if (m === 'whisper-1' || m === 'voxtral-mini-latest') return null
  }

  if (m.startsWith('claude-sonnet') || m.startsWith('claude-opus')) {
    return { bucket: 'claude-sonnet', cap: PREMIUM_BUCKET_CAPS['claude-sonnet']! }
  }
  if (m === 'gpt-5' || m.startsWith('gpt-5.') || m.startsWith('gpt-5-')) {
    // gpt-5-mini déjà filtré plus haut. gpt-5, gpt-5.5, gpt-5-turbo, etc. → 100.
    return { bucket: 'gpt-5', cap: PREMIUM_BUCKET_CAPS['gpt-5']! }
  }
  // Covers every versioned Pro ID exposed by the clients/catalogue, including
  // gemini-2.5-pro (which the former gemini-2-pro substring missed), preview
  // suffixes and the unversioned gemini-pro aliases.
  if (/^gemini-(?:\d+(?:\.\d+)?-)?pro(?:$|[-.])/.test(m)) {
    return { bucket: 'gemini-pro', cap: PREMIUM_BUCKET_CAPS['gemini-pro']! }
  }

  if (!hasKnownPricing(m)) {
    return { bucket: 'unknown-model', cap: PREMIUM_BUCKET_CAPS['unknown-model']! }
  }
  return null
}

/** YYYY-MM en UTC — aligné sur quota.ts. */
function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

async function ensurePremiumTable(env: Env): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS premium_cap (
        email TEXT NOT NULL,
        month TEXT NOT NULL,
        bucket TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (email, month, bucket)
      )`
    ).run()
  } catch (err) {
    console.error('[premiumCap] ensure table failed', err)
  }
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
      `SELECT user_email, ls_order_id FROM premium_packs
       WHERE user_email = ?1 AND messages_used < messages_total
       ORDER BY created_at ASC, ls_order_id ASC
       LIMIT 1`
    )
      .bind(email)
      .first<{ user_email: string; ls_order_id: string }>()

    if (!oldest) return false

    const res = await env.DB.prepare(
      `UPDATE premium_packs
       SET messages_used = messages_used + 1
       WHERE user_email = ?1 AND ls_order_id = ?2 AND messages_used < messages_total`
    )
      .bind(oldest.user_email, oldest.ls_order_id)
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
 * Compteur en D1 (table `premium_cap`), atomique : upsert conditionnel
 * `... DO UPDATE SET count = count + 1 WHERE count < cap RETURNING count`
 * (voir atomicQuota.ts). Migré depuis KV (mai 2026) car KV n'a pas de CAS →
 * 2 requêtes simultanées pouvaient passer le cap (impact € réel sur les
 * modèles chers). Le pattern conditionnel ne dépasse JAMAIS le cap.
 *
 * Failsafe : en cas d'erreur/timeout D1, on autorise (fail-open) — on préfère
 * un dépassement rare à un blocage utilisateur sur incident infra. Le fail-open
 * sur le cap premium est loggé distinctement (`[premium-cap] FAIL-OPEN`) pour
 * pouvoir alerter (modèles chers).
 */
export async function checkPremiumCap(
  email: string,
  model: string,
  env: Env
): Promise<PremiumCapResult> {
  const entry = classifyPremiumModel(model)
  if (!entry) return { allowed: true, reason: 'standard_model' }

  if (!env.DB) {
    // D1 pas bindé : fail-open mais log — l'admin doit binder DB.
    console.error('[premium-cap] FAIL-OPEN: DB binding missing')
    return { allowed: true, reason: 'standard_model' }
  }

  const month = currentMonthKey()
  await ensurePremiumTable(env)
  // GC paresseux des mois passés (D1 n'a pas de TTL comme KV).
  await maybeCleanup(env, `DELETE FROM premium_cap WHERE month < ?1`, [month])

  const outcome = await consumeCapAtomic(
    env,
    `INSERT INTO premium_cap (email, month, bucket, count, updated_at)
     VALUES (?1, ?2, ?3, 1, unixepoch())
     ON CONFLICT (email, month, bucket) DO UPDATE SET count = count + 1, updated_at = unixepoch()
       WHERE premium_cap.count < ?4
     RETURNING count`,
    [email, month, entry.bucket, entry.cap]
  )

  if (outcome.status === 'consumed') {
    return {
      allowed: true,
      reason: 'monthly_cap',
      remaining: Math.max(0, entry.cap - outcome.count),
      bucket: entry.bucket,
      cap: entry.cap,
    }
  }

  if (outcome.status === 'fail_open') {
    // Alerte : fail-open sur un modèle premium (cher). Log distinctif greppable
    // dans `wrangler tail` / dashboard. (Hook d'alerte externe possible plus tard.)
    console.error(
      `[premium-cap] FAIL-OPEN bucket=${entry.bucket} email=${email.slice(0, 3)}... (D1 lent/down, requête laissée passer)`
    )
    return { allowed: true, reason: 'monthly_cap', bucket: entry.bucket, cap: entry.cap }
  }

  // cap_reached → tenter un Pack Premium acheté (table premium_packs, déjà atomique).
  const packConsumed = await consumePremiumPack(env, email)
  if (packConsumed) {
    return { allowed: true, reason: 'premium_pack', remaining: 0, bucket: entry.bucket, cap: entry.cap }
  }
  return { allowed: false, reason: 'cap_reached', remaining: 0, bucket: entry.bucket, cap: entry.cap }
}

/**
 * Rembourse UNE consommation de cap premium quand l'upstream n'a PAS servi
 * la réponse (revue C3, 18/07/2026) — invariant : « cap consommé ⟺ message
 * servi ». Sans ça, le retry d'éligibilité du client (Terra rejeté → gpt-5,
 * openaiClient.startChatRequest) faisait consommer le bucket DEUX FOIS pour
 * un seul message (aucun voidPremiumCap n'existait, seul le wallet avait son
 * void). Bug pré-existant (5.5→5), ré-exposé par le swap C3.
 *
 * - reason 'monthly_cap' : décrémente la ligne (email, month, bucket),
 *   jamais sous 0.
 * - reason 'premium_pack' : re-crédite un pack entamé. Le solde est un
 *   SUM(total - used) → décrémenter N'IMPORTE QUEL pack avec used > 0
 *   restaure exactement 1 crédit ; on cible le plus ancien entamé pour
 *   rester déterministe (l'ordre FIFO peut être légèrement perturbé, le
 *   TOTAL reste exact).
 * - autres reasons ('standard_model', fail-open sans bucket) : no-op.
 * Best-effort (waitUntil) : un échec de remboursement est loggé, jamais
 * propagé — pire cas = l'ancien comportement (une unité perdue).
 */
export async function voidPremiumCap(
  env: Env,
  email: string,
  consumed: PremiumCapResult
): Promise<void> {
  if (!env.DB || !consumed.allowed || !consumed.bucket) return
  try {
    if (consumed.reason === 'monthly_cap') {
      await env.DB.prepare(
        `UPDATE premium_cap SET count = MAX(0, count - 1), updated_at = unixepoch()
         WHERE email = ?1 AND month = ?2 AND bucket = ?3`
      )
        .bind(email, currentMonthKey(), consumed.bucket)
        .run()
      return
    }
    if (consumed.reason === 'premium_pack') {
      const target = await env.DB.prepare(
        `SELECT user_email, ls_order_id FROM premium_packs
         WHERE user_email = ?1 AND messages_used > 0
         ORDER BY created_at ASC, ls_order_id ASC
         LIMIT 1`
      )
        .bind(email)
        .first<{ user_email: string; ls_order_id: string }>()
      if (!target) return
      await env.DB.prepare(
        `UPDATE premium_packs SET messages_used = MAX(0, messages_used - 1)
         WHERE user_email = ?1 AND ls_order_id = ?2`
      )
        .bind(target.user_email, target.ls_order_id)
        .run()
    }
  } catch (err) {
    console.error('[premium-cap] void failed (unité perdue, non bloquant)', err)
  }
}

/**
 * Réponse 429 standardisée à renvoyer aux clients quand le cap est atteint
 * et qu'aucun pack n'est disponible. Le flag `upsell` permet au front
 * d'afficher la modale de choix (P0.7 — jamais de blocage muet) ; `bucket`
 * et `cap` permettent d'afficher « 150/150 Sonnet utilisés » avec précision.
 * Le `message` FR est un fallback — le client intercepte le code
 * `premium_cap_reached` et affiche sa propre UI i18n.
 */
export function premiumCapReachedResponse(cap?: PremiumCapResult): Response {
  return Response.json(
    {
      error: 'premium_cap_reached',
      message:
        'Tu as atteint ta limite mensuelle pour ce modèle. Achète un Pack Premium pour continuer.',
      upsell: true,
      bucket: cap?.bucket,
      cap: cap?.cap,
    },
    { status: 429 }
  )
}
