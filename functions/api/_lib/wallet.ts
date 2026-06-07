import type { Env } from '../../env'
import { chargeForUsageMicro, type Modality } from './creditPricing'
import type { UsageTokens } from './pricing'

// ─────────────────────────────────────────────────────────────────────
// Lib WALLET — crédits prépayés (réserve / settle / void / top-up).
//
// Modèle réserve/settle : on RÉSERVE un coût estimé (pessimiste) AVANT l'appel
// IA, on règle le coût RÉEL APRÈS le stream. `wallet` est le cache atomique du
// hot path ; `credit_ledger` (append-only) est la vérité comptable.
//
// Invariants tenus ici :
//   I1 — Pas d'overspend concurrent : la réserve est un UPDATE conditionnel
//        atomique `WHERE (balance - reserved) >= est`. D1/SQLite sérialise les
//        écritures sur la primary → deux requêtes concurrentes ne peuvent pas
//        réserver le même disponible (même garantie que consumeCapAtomic).
//   I2 — settle ⊕ void exclusifs : le flip de `reservation.status`
//        'open' → 'settled' | 'voided' via UPDATE conditionnel RETURNING est le
//        mutex. Le perdant voit 0 ligne et s'abstient → jamais de double-mouvement.
//   I3 — Idempotence top-up : crédit puis claim de l'event dans une SEULE
//        transaction `batch`, le crédit étant gardé par NOT EXISTS webhook_event.
//        Un replay d'event signé ne re-crédite donc pas.
//
// Décisions (cf. plan crédits, 7 juin 2026) :
//   - Échec D1 sur la réserve → renvoie 'db_unavailable'. PAS de fail-open
//     implicite (contrairement à consumeCapAtomic) : sur de l'argent, c'est au
//     CALLER d'appliquer la politique fail-closed graduée par modalité.
//   - Settle → 3 écritures séquentielles (flip, débit wallet, ligne ledger) hors
//     du chemin de latence client (waitUntil), avec un retry court ; le résiduel
//     rarissime (~1 appel) est rattrapé par la réconciliation nocturne.
//
// ⚠️ Sémantique SQLite load-bearing (à ne pas "simplifier") :
//   - `ON CONFLICT(col) DO UPDATE SET ... WHERE <expr>` : le WHERE conditionne
//     l'UPDATE de conflit.
//   - `INSERT ... SELECT ... WHERE NOT EXISTS (...)` : insert conditionnel.
//   - Dans un `batch`, les statements s'exécutent en séquence dans UNE
//     transaction ; un statement voit les effets des précédents, pas des suivants.
// ─────────────────────────────────────────────────────────────────────

const D1_TIMEOUT_MS = 250
const RESERVATION_STALE_MINUTES = 10 // au-delà, le sweeper void une réservation 'open'

let tablesEnsured = false

export type ReserveResult =
  | { status: 'reserved'; availableAfterMicro: number }
  | { status: 'insufficient' }
  | { status: 'db_unavailable' }

export type SettleResult =
  | { status: 'settled'; chargedMicro: number }
  | { status: 'already_finalized' } // déjà settled ou voided (idempotent)
  | { status: 'error' }

export type VoidResult = { status: 'voided' | 'already_finalized' | 'error' }

export type CreditResult = { status: 'credited' | 'duplicate' | 'error'; balanceAfterMicro?: number }

export interface WalletBalance {
  balanceMicro: number
  reservedMicro: number
  availableMicro: number
}

/** Race une requête D1 contre un timeout. Pour borner la latence du hot path. */
async function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | '__timeout__'> {
  const t = new Promise<'__timeout__'>((resolve) => setTimeout(() => resolve('__timeout__'), ms))
  return Promise.race([p, t])
}

/**
 * Crée les tables wallet en lazy si absentes (BUG 38 : une table non créée au
 * 1er appel = 500). DDL en miroir de migrations/0004_wallet.sql ; la migration
 * reste la source pour les déploiements propres, ceci est le filet runtime.
 * Idempotent + mémoïsé par worker chaud.
 */
export async function ensureWalletTables(env: Env): Promise<void> {
  if (tablesEnsured || !env.DB) return
  try {
    await env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS wallet (
           user_email TEXT PRIMARY KEY,
           balance_micro INTEGER NOT NULL DEFAULT 0,
           reserved_micro INTEGER NOT NULL DEFAULT 0,
           currency TEXT NOT NULL DEFAULT 'USD',
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS credit_ledger (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           user_email TEXT NOT NULL,
           amount_micro INTEGER NOT NULL,
           kind TEXT NOT NULL,
           ref_type TEXT, ref_id TEXT,
           provider_cost_micro INTEGER,
           model TEXT, modality TEXT, meta TEXT,
           balance_after INTEGER,
           created_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ),
      env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_email
           ON credit_ledger(user_email, created_at)`,
      ),
      env.DB.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_settle_once
           ON credit_ledger(ref_type, ref_id, kind)
           WHERE kind IN ('debit', 'refund', 'chargeback')`,
      ),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS webhook_event (
           provider TEXT NOT NULL, event_id TEXT NOT NULL,
           order_id TEXT, user_email TEXT, amount_micro INTEGER, kind TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           PRIMARY KEY (provider, event_id)
         )`,
      ),
      env.DB.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_event_order
           ON webhook_event(provider, order_id) WHERE order_id IS NOT NULL`,
      ),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS reservation (
           id TEXT PRIMARY KEY, user_email TEXT NOT NULL,
           reserved_micro INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open',
           model TEXT, modality TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')), settled_at TEXT
         )`,
      ),
      env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_reservation_sweep
           ON reservation(status, created_at)`,
      ),
    ])
    tablesEnsured = true
  } catch (err) {
    console.error('[wallet] ensureWalletTables échec (non bloquant)', err)
  }
}

/** Lit le solde. null si l'utilisateur n'a pas de wallet (jamais rechargé). */
export async function getWalletBalance(env: Env, email: string): Promise<WalletBalance | null> {
  if (!env.DB) return null
  await ensureWalletTables(env)
  const row = await env.DB.prepare(
    `SELECT balance_micro, reserved_micro FROM wallet WHERE user_email = ?1`,
  )
    .bind(email)
    .first<{ balance_micro: number; reserved_micro: number }>()
  if (!row) return null
  return {
    balanceMicro: row.balance_micro,
    reservedMicro: row.reserved_micro,
    availableMicro: row.balance_micro - row.reserved_micro,
  }
}

/**
 * RÉSERVE (hot path, AVANT l'appel IA).
 * Ordre choisi : on insère d'abord la réservation 'open' (le settle en aura
 * besoin pour son flip), PUIS on prend le hold conditionnel. Si le hold échoue
 * (fonds insuffisants / D1 indispo), on annule la réservation tout juste créée.
 * Garantit qu'un statut 'reserved' implique TOUJOURS hold pris + ligne présente.
 */
export async function reserveCredits(
  env: Env,
  params: { email: string; estMicro: number; resId: string; model: string; modality: Modality },
): Promise<ReserveResult> {
  const { email, estMicro, resId, model, modality } = params
  if (!env.DB) return { status: 'db_unavailable' }
  await ensureWalletTables(env)
  try {
    // 1. Journal de la réservation (le sweeper et le settle s'appuient dessus).
    await env.DB.prepare(
      `INSERT INTO reservation (id, user_email, reserved_micro, status, model, modality)
       VALUES (?1, ?2, ?3, 'open', ?4, ?5)`,
    )
      .bind(resId, email, estMicro, model, modality)
      .run()

    // 2. Hold conditionnel atomique (l'autorité anti-overspend), borné en latence.
    const holdQuery = env.DB.prepare(
      `UPDATE wallet SET reserved_micro = reserved_micro + ?2, updated_at = datetime('now')
       WHERE user_email = ?1 AND (balance_micro - reserved_micro) >= ?2
       RETURNING (balance_micro - reserved_micro) AS available_after`,
    )
      .bind(email, estMicro)
      .first<{ available_after: number }>()
    const raced = await raceTimeout(holdQuery, D1_TIMEOUT_MS)

    if (raced === '__timeout__') {
      // Le timeout n'annule pas la requête D1 : l'UPDATE peut s'appliquer côté
      // serveur APRÈS coup. Ne PAS discard (un hold pris fuiterait) — laisser la
      // réservation 'open' pour que le sweeper rende l'éventuel hold.
      console.error('[wallet] hold D1 timeout — réservation laissée au sweeper')
      return { status: 'db_unavailable' }
    }
    const row = raced as { available_after: number } | null
    if (!row) {
      // Réponse définitive : le WHERE était faux → aucun hold pris → discard sûr.
      await discardReservation(env, resId)
      return { status: 'insufficient' }
    }
    return { status: 'reserved', availableAfterMicro: row.available_after }
  } catch (err) {
    // Exception ambiguë : impossible de savoir si le hold a appliqué → ne pas
    // discard, laisser le sweeper rendre un hold orphelin éventuel.
    console.error('[wallet] reserve erreur — réservation laissée au sweeper', err)
    return { status: 'db_unavailable' }
  }
}

/** Supprime une réservation jamais "tenue" (aucun hold pris). Best-effort. */
async function discardReservation(env: Env, resId: string): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM reservation WHERE id = ?1 AND status = 'open'`).bind(resId).run()
  } catch (err) {
    console.error('[wallet] discardReservation ignoré', err)
  }
}

/**
 * SETTLE (après le stream, dans waitUntil — hors latence client).
 * 1) flip mutex 'open'→'settled' (RETURNING le montant réservé) ; si 0 ligne,
 *    la réservation a déjà été settled ou voided → no-op idempotent.
 * 2) rend le hold (reserved -= réservé) et débite le coût réel (balance -= réel).
 * 3) écrit la ligne ledger 'debit' (ON CONFLICT DO NOTHING = filet anti-doublon).
 * Étapes 2-3 retentées une fois ; au pire la réconciliation nocturne rattrape.
 */
export async function settleCredits(
  env: Env,
  params: { resId: string; email: string; model: string; modality: Modality; usage: UsageTokens },
): Promise<SettleResult> {
  const { resId, email, model, modality, usage } = params
  if (!env.DB) return { status: 'error' }
  const { chargeMicro, providerCostMicro } = chargeForUsageMicro(model, usage)

  // 1. Mutex : seul le gagnant du flip applique le mouvement.
  let claim: { reserved_micro: number } | null
  try {
    claim = await env.DB.prepare(
      `UPDATE reservation SET status = 'settled', settled_at = datetime('now')
       WHERE id = ?1 AND status = 'open'
       RETURNING reserved_micro`,
    )
      .bind(resId)
      .first<{ reserved_micro: number }>()
  } catch (err) {
    console.error('[wallet] settle flip erreur', err)
    return { status: 'error' }
  }
  if (!claim) return { status: 'already_finalized' }
  const reservedMicro = claim.reserved_micro

  const meta = JSON.stringify({
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheCreation: usage.cacheCreationTokens,
  })

  // 2-3. Mouvement money + ledger, avec un retry court (settle hors latence).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const walletRow = await env.DB.prepare(
        `UPDATE wallet SET reserved_micro = MAX(0, reserved_micro - ?2),
           balance_micro = balance_micro - ?3, updated_at = datetime('now')
         WHERE user_email = ?1
         RETURNING balance_micro`,
      )
        .bind(email, reservedMicro, chargeMicro)
        .first<{ balance_micro: number }>()
      const balanceAfter = walletRow?.balance_micro ?? null

      await env.DB.prepare(
        `INSERT INTO credit_ledger
           (user_email, amount_micro, kind, ref_type, ref_id, provider_cost_micro, model, modality, meta, balance_after)
         VALUES (?1, ?2, 'debit', 'reservation', ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT DO NOTHING`,
      )
        .bind(email, -chargeMicro, resId, providerCostMicro, model, modality, meta, balanceAfter)
        .run()

      return { status: 'settled', chargedMicro: chargeMicro }
    } catch (err) {
      console.error(`[wallet] settle mouvement échec (tentative ${attempt + 1})`, err)
    }
  }
  // La réservation est 'settled' mais le mouvement n'a pas abouti → drift que la
  // réconciliation nocturne détecte (SUM(ledger) vs wallet). Résiduel accepté.
  return { status: 'error' }
}

/**
 * VOID — rend intégralement le hold (appel échoué côté upstream, ou sweeper).
 * Même mutex que settle : flip 'open'→'voided' ; le perdant s'abstient.
 */
export async function voidReservation(env: Env, resId: string, email: string): Promise<VoidResult> {
  if (!env.DB) return { status: 'error' }
  try {
    const claim = await env.DB.prepare(
      `UPDATE reservation SET status = 'voided', settled_at = datetime('now')
       WHERE id = ?1 AND status = 'open'
       RETURNING reserved_micro`,
    )
      .bind(resId)
      .first<{ reserved_micro: number }>()
    if (!claim) return { status: 'already_finalized' }
    await env.DB.prepare(
      `UPDATE wallet SET reserved_micro = MAX(0, reserved_micro - ?2), updated_at = datetime('now')
       WHERE user_email = ?1`,
    )
      .bind(email, claim.reserved_micro)
      .run()
    return { status: 'voided' }
  } catch (err) {
    console.error('[wallet] void erreur', err)
    return { status: 'error' }
  }
}

/**
 * SWEEPER — void les réservations 'open' trop anciennes (crash entre réserve et
 * settle). Best-effort, à appeler en probabiliste (maybeCleanup-style) et/ou Cron.
 * Rend les holds un par un pour garder la comptabilité par-utilisateur exacte.
 */
export async function sweepStaleReservations(env: Env, limit = 50): Promise<number> {
  if (!env.DB) return 0
  try {
    const stale = await env.DB.prepare(
      `SELECT id, user_email FROM reservation
       WHERE status = 'open' AND created_at < datetime('now', ?1)
       LIMIT ?2`,
    )
      .bind(`-${RESERVATION_STALE_MINUTES} minutes`, limit)
      .all<{ id: string; user_email: string }>()
    let swept = 0
    for (const r of stale.results ?? []) {
      const res = await voidReservation(env, r.id, r.user_email)
      if (res.status === 'voided') swept++
    }
    return swept
  } catch (err) {
    console.error('[wallet] sweep erreur', err)
    return 0
  }
}

/**
 * TOP-UP — crédite le wallet de façon IDEMPOTENTE (appelé par le webhook MoR
 * APRÈS vérification de signature + paiement réellement capturé).
 * Crédit gardé par NOT EXISTS webhook_event, puis claim de l'event, le tout dans
 * UNE transaction `batch`. Un replay d'event signé ne re-crédite pas (I3).
 * Le montant vient du payload SIGNÉ (recoupé table produits côté caller),
 * jamais d'un champ libre.
 */
export async function creditWallet(
  env: Env,
  params: {
    provider: string
    eventId: string
    orderId?: string
    email: string
    amountMicro: number
    kind?: 'topup' | 'refund' | 'chargeback'
  },
): Promise<CreditResult> {
  const { provider, eventId, orderId, email, amountMicro, kind = 'topup' } = params
  if (!env.DB) return { status: 'error' }
  await ensureWalletTables(env)
  try {
    const results = await env.DB.batch([
      // 1. Crédit du solde, uniquement si l'event n'a pas déjà été traité.
      env.DB.prepare(
        `INSERT INTO wallet (user_email, balance_micro, currency)
         VALUES (?1, ?2, 'USD')
         ON CONFLICT(user_email) DO UPDATE SET
           balance_micro = balance_micro + ?2, updated_at = datetime('now')
           WHERE NOT EXISTS (SELECT 1 FROM webhook_event WHERE provider = ?3 AND event_id = ?4)`,
      ).bind(email, amountMicro, provider, eventId),
      // 2. Ligne ledger correspondante, même garde.
      env.DB.prepare(
        `INSERT INTO credit_ledger (user_email, amount_micro, kind, ref_type, ref_id)
         SELECT ?1, ?2, ?3, 'mor_order', ?4
         WHERE NOT EXISTS (SELECT 1 FROM webhook_event WHERE provider = ?5 AND event_id = ?6)`,
      ).bind(email, amountMicro, kind, orderId ?? eventId, provider, eventId),
      // 3. Claim de l'event (marque "traité"). ON CONFLICT = replay → no-op.
      env.DB.prepare(
        `INSERT INTO webhook_event (provider, event_id, order_id, user_email, amount_micro, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING`,
      ).bind(provider, eventId, orderId ?? null, email, amountMicro, kind),
    ])
    // Le statement 3 n'a inséré une ligne que si l'event était nouveau.
    const claimChanges = results?.[2]?.meta?.changes ?? 0
    return { status: claimChanges > 0 ? 'credited' : 'duplicate' }
  } catch (err) {
    console.error('[wallet] creditWallet erreur', err)
    return { status: 'error' }
  }
}
