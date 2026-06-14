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
// PRINCIPE DE CORRECTION (revue RÈGLE 7, 2 agents Opus) : CHAQUE mouvement
// d'argent est une SEULE transaction `batch()` (D1 = transaction tout-ou-rien,
// statements vus en séquence) qui est AUSSI idempotente. L'idempotence vient
// du statut de la réservation ('open' gardant settle/void) ou de NOT EXISTS
// webhook_event (par event_id seul) pour les top-ups. Conséquence : un retry
// — même après un commit "perdu" côté réseau — ne re-débite ni ne re-crédite
// jamais. Pas de séquence non-transactionnelle de 2 écritures (la source des
// doubles-débits/crédits trouvés en revue).
//
// Invariants :
//   I1 — Pas d'overspend concurrent : le hold est `WHERE (balance-reserved)>=est`.
//   I2 — settle ⊕ void exclusifs : le flip 'open'→X est le mutex ; le perdant
//        voit le statut ≠ 'open' et n'applique aucun mouvement.
//   I3 — Idempotence top-up : garde NOT EXISTS sur (provider, event_id) seul.
//        Creem émet des event_id stables ; PAS de dédoublonnage order_id (un
//        refund partage l'order_id du top-up et doit passer comme event distinct).
//   I4 — Réservation présente ⟺ hold pris : réserve = batch couplé (résa + hold
//        gardés par la MÊME condition de solde) → jamais de résa orpheline.
//
// Décisions (plan crédits, 7 juin 2026) :
//   - Échec D1 sur la réserve → 'db_unavailable' (PAS de fail-open implicite) ;
//     le CALLER applique la politique fail-closed graduée par modalité.
//   - Settle : batch idempotent + retry court ; résiduel rattrapé par la
//     réconciliation nocturne (requêtes documentées en bas de fichier).
//
// CONTRAT SÉCURITÉ : `email` est TOUJOURS l'email du token Google VÉRIFIÉ côté
// serveur (sub), JAMAIS un champ de body/query (sinon IDOR, cf. CRIT-1). Pour
// creditWallet, email/amount/event viennent du payload webhook SIGNÉ + table
// produits figée — voir le câblage webhook (à venir).
// ─────────────────────────────────────────────────────────────────────

const D1_TIMEOUT_MS = 250
// Seuil sweeper : au-delà de cette INACTIVITÉ (updated_at), une réservation
// 'open' est considérée orpheline. Une réservation = UN tour HTTP (jamais > ~10
// min, timeouts providers) → 15 min ne void jamais un appel en vol, tout en
// récupérant vite les réserves gelées par un settle/void raté (auto-soin).
const RESERVATION_STALE_MINUTES = 15

let tablesEnsured = false

export type ReserveResult = { status: 'reserved' | 'insufficient' | 'db_unavailable' }
export type SettleResult =
  | { status: 'settled'; chargedMicro: number }
  | { status: 'already_finalized' }
  | { status: 'error' }
export type VoidResult = { status: 'voided' | 'already_finalized' | 'error' }
export type CreditResult = { status: 'credited' | 'duplicate' | 'error' }

export interface WalletBalance {
  balanceMicro: number
  reservedMicro: number
  availableMicro: number
}

/** Race une requête D1 contre un timeout, pour borner la latence du hot path. */
async function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | '__timeout__'> {
  const t = new Promise<'__timeout__'>((resolve) => setTimeout(() => resolve('__timeout__'), ms))
  return Promise.race([p, t])
}

/**
 * Crée les tables wallet en lazy si absentes (BUG 38). DDL en miroir EXACT de
 * migrations/0004_wallet.sql (la migration reste la source pour les déploiements
 * propres, ceci est le filet runtime). Idempotent + mémoïsé par worker chaud.
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
        `CREATE TABLE IF NOT EXISTS reservation (
           id TEXT PRIMARY KEY, user_email TEXT NOT NULL,
           reserved_micro INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open',
           model TEXT, modality TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now')), settled_at TEXT
         )`,
      ),
      env.DB.prepare(
        `CREATE INDEX IF NOT EXISTS idx_reservation_sweep
           ON reservation(status, updated_at)`,
      ),
    ])
    tablesEnsured = true
  } catch (err) {
    console.error('[wallet] ensureWalletTables échec (non bloquant)', err)
  }
}

/**
 * Lit le solde. null si l'utilisateur n'a pas de wallet (jamais rechargé) OU si
 * D1 est indisponible/lent. RÉSILIENT par conception : cette lecture est sur le
 * hot path de TOUS les users sans abo (y compris ceux sans wallet) ; un incident
 * D1 ne doit JAMAIS faire planter leur requête — on retombe sur 'pas de wallet'
 * (→ tier gratuit), comme avant l'arrivée des crédits. (La RÉSERVE, elle, reste
 * fail-closed : pas de premium gratuit pendant un incident.)
 */
export async function getWalletBalance(env: Env, email: string): Promise<WalletBalance | null> {
  if (!env.DB) return null
  await ensureWalletTables(env)
  try {
    const query = env.DB.prepare(
      `SELECT balance_micro, reserved_micro FROM wallet WHERE user_email = ?1`,
    )
      .bind(email)
      .first<{ balance_micro: number; reserved_micro: number }>()
    const raced = await raceTimeout(query, D1_TIMEOUT_MS)
    if (raced === '__timeout__') {
      console.error('[wallet] getWalletBalance D1 timeout — traité comme pas de wallet')
      return null
    }
    const row = raced as { balance_micro: number; reserved_micro: number } | null
    if (!row) return null
    return {
      balanceMicro: row.balance_micro,
      reservedMicro: row.reserved_micro,
      availableMicro: row.balance_micro - row.reserved_micro,
    }
  } catch (err) {
    console.error('[wallet] getWalletBalance erreur — traité comme pas de wallet', err)
    return null
  }
}

/**
 * RÉSERVE (hot path, AVANT l'appel IA). Batch couplé atomique (I4) :
 *   stmt0 — INSERT réservation 'open' SI le solde suffit ;
 *   stmt1 — prend le hold (reserved += est) SI le solde suffit (même condition).
 * stmt0 ne touche pas le wallet → les deux voient le même solde → soit les deux
 * s'appliquent, soit aucun. Pas de discard, pas de résa orpheline (fix P3).
 * On lit `meta.changes` du hold (stmt1) pour le verdict.
 */
export async function reserveCredits(
  env: Env,
  params: { email: string; estMicro: number; resId: string; model: string; modality: Modality },
): Promise<ReserveResult> {
  const { email, estMicro, resId, model, modality } = params
  if (!env.DB) return { status: 'db_unavailable' }
  await ensureWalletTables(env)
  try {
    const raced = await raceTimeout(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO reservation (id, user_email, reserved_micro, status, model, modality)
           SELECT ?1, ?2, ?3, 'open', ?4, ?5
           WHERE EXISTS (SELECT 1 FROM wallet WHERE user_email = ?2 AND (balance_micro - reserved_micro) >= ?3)`,
        ).bind(resId, email, estMicro, model, modality),
        env.DB.prepare(
          `UPDATE wallet SET reserved_micro = reserved_micro + ?2, updated_at = datetime('now')
           WHERE user_email = ?1 AND (balance_micro - reserved_micro) >= ?2`,
        ).bind(email, estMicro),
      ]),
      D1_TIMEOUT_MS,
    )
    if (raced === '__timeout__') {
      // Le timeout n'ANNULE PAS le batch (D1 n'a pas d'abort) : il peut commiter
      // côté serveur après coup → un hold transitoire est pris alors qu'on refuse
      // côté caller. Ce hold est BORNÉ et récupéré par le sweeper (≤15 min) ; il
      // ne bloque que le solde de CET user, jamais d'overspend ni de perte. (Le
      // batch reste atomique résa+hold couplés → pas de résa orpheline sans hold.)
      console.error('[wallet] reserve D1 timeout')
      return { status: 'db_unavailable' }
    }
    const held = raced[1]?.meta?.changes ?? 0
    return held > 0 ? { status: 'reserved' } : { status: 'insufficient' }
  } catch (err) {
    console.error('[wallet] reserve erreur', err)
    return { status: 'db_unavailable' }
  }
}

/**
 * SETTLE (après le stream, dans waitUntil — hors latence client). UNE seule
 * transaction atomique idempotente (fix P2 + double-débit B1) :
 *   stmt0 — rend le hold + débite le coût réel, gardé par EXISTS(résa 'open') ;
 *   stmt1 — écrit la ligne ledger 'debit', même garde + ON CONFLICT ;
 *   stmt2 — flip 'open'→'settled' (mutex settle/void).
 * Tant que la résa est 'open', les 3 s'appliquent ensemble ; sur un re-run
 * (déjà 'settled' ou 'voided'), EXISTS('open') est faux partout → no-op total.
 * Donc le retry est SÛR (jamais de double-débit). On lit le flip (stmt2) pour
 * distinguer settled vs already_finalized.
 *
 * ⚠️ INVARIANT CRITIQUE : ces 3 statements DOIVENT rester dans le même batch().
 * Leur atomicité transactionnelle EST le fix du double-débit (BUG B1). Les
 * séparer en écritures séquentielles RÉINTRODUIT B1 (vérifié en revue Opus,
 * juin 2026). Idem pour void (2 statements) et creditWallet (4 statements).
 */
export async function settleCredits(
  env: Env,
  params: { resId: string; email: string; model: string; modality: Modality; usage: UsageTokens },
): Promise<SettleResult> {
  const { resId, email, model, modality, usage } = params
  if (!env.DB) return { status: 'error' }
  // chargeForUsageMicro assainit l'usage → chargeMicro toujours fini et > 0 (fix P6).
  const { chargeMicro, providerCostMicro } = chargeForUsageMicro(model, usage)
  const meta = JSON.stringify({
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheCreation: usage.cacheCreationTokens,
  })

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await env.DB.batch([
        env.DB.prepare(
          // Durcissement (audit 14 juin) : les sous-requêtes corrèlent sur
          // `user_email` en plus de `id` → une réservation ne peut JAMAIS
          // toucher le wallet d'un autre user, même si l'appelant passait un
          // email incohérent. La sécurité ne dépend plus du seul contrat appelant.
          `UPDATE wallet SET
             reserved_micro = MAX(0, reserved_micro - (SELECT reserved_micro FROM reservation WHERE id = ?1 AND status = 'open' AND user_email = ?3)),
             balance_micro = balance_micro - ?2,
             updated_at = datetime('now')
           WHERE user_email = ?3 AND EXISTS (SELECT 1 FROM reservation WHERE id = ?1 AND status = 'open' AND user_email = ?3)`,
        ).bind(resId, chargeMicro, email),
        env.DB.prepare(
          `INSERT INTO credit_ledger
             (user_email, amount_micro, kind, ref_type, ref_id, provider_cost_micro, model, modality, meta)
           SELECT ?1, ?2, 'debit', 'reservation', ?3, ?4, ?5, ?6, ?7
           WHERE EXISTS (SELECT 1 FROM reservation WHERE id = ?3 AND status = 'open' AND user_email = ?1)
           ON CONFLICT DO NOTHING`,
        ).bind(email, -chargeMicro, resId, providerCostMicro, model, modality, meta),
        env.DB.prepare(
          `UPDATE reservation SET status = 'settled', settled_at = datetime('now')
           WHERE id = ?1 AND status = 'open'`,
        ).bind(resId),
      ])
      const flipped = res[2]?.meta?.changes ?? 0
      return flipped > 0 ? { status: 'settled', chargedMicro: chargeMicro } : { status: 'already_finalized' }
    } catch (err) {
      console.error(`[wallet] settle échec (tentative ${attempt + 1})`, err)
    }
  }
  // Le batch n'a jamais abouti → la résa reste 'open', le sweeper la voidera (le
  // débit de CET appel est perdu = résiduel rarissime accepté). Détectable aussi
  // par la requête de réconciliation (voir bas de fichier).
  return { status: 'error' }
}

/**
 * VOID — rend intégralement le hold (appel upstream échoué, ou sweeper). UNE
 * transaction atomique idempotente (fix B4) :
 *   stmt0 — rend le hold, gardé par EXISTS(résa 'open') ;
 *   stmt1 — flip 'open'→'voided' (mutex).
 * Re-run → EXISTS('open') faux → no-op. Si settle a déjà gagné le flip, void
 * est un no-op (et inversement).
 */
export async function voidReservation(env: Env, resId: string, email: string): Promise<VoidResult> {
  if (!env.DB) return { status: 'error' }
  try {
    const res = await env.DB.batch([
      env.DB.prepare(
        // Durcissement (audit 14 juin) : corrélation sur user_email (cf. settle).
        `UPDATE wallet SET
           reserved_micro = MAX(0, reserved_micro - (SELECT reserved_micro FROM reservation WHERE id = ?1 AND status = 'open' AND user_email = ?2)),
           updated_at = datetime('now')
         WHERE user_email = ?2 AND EXISTS (SELECT 1 FROM reservation WHERE id = ?1 AND status = 'open' AND user_email = ?2)`,
      ).bind(resId, email),
      env.DB.prepare(
        `UPDATE reservation SET status = 'voided', settled_at = datetime('now')
         WHERE id = ?1 AND status = 'open'`,
      ).bind(resId),
    ])
    const flipped = res[1]?.meta?.changes ?? 0
    return flipped > 0 ? { status: 'voided' } : { status: 'already_finalized' }
  } catch (err) {
    console.error('[wallet] void erreur', err)
    return { status: 'error' }
  }
}

/**
 * SWEEPER — void les réservations 'open' inactives depuis plus de RESERVATION_STALE_MINUTES
 * (crash entre réserve et settle). Balaie sur `updated_at` (heartbeat) pour ne
 * pas tuer un stream long en vol (fix P1). Best-effort, probabiliste + Cron.
 */
export async function sweepStaleReservations(
  env: Env,
  opts: { email?: string; limit?: number } = {},
): Promise<number> {
  if (!env.DB) return 0
  const { email, limit = 50 } = opts
  const interval = `-${RESERVATION_STALE_MINUTES} minutes`
  try {
    const stale = await (email
      ? env.DB.prepare(
          `SELECT id, user_email FROM reservation
           WHERE status = 'open' AND updated_at < datetime('now', ?1) AND user_email = ?3
           LIMIT ?2`,
        ).bind(interval, limit, email)
      : env.DB.prepare(
          `SELECT id, user_email FROM reservation
           WHERE status = 'open' AND updated_at < datetime('now', ?1)
           LIMIT ?2`,
        ).bind(interval, limit)
    ).all<{ id: string; user_email: string }>()
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

/** Heartbeat d'une réservation pendant un stream long (repousse le sweeper). */
export async function touchReservation(env: Env, resId: string): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `UPDATE reservation SET updated_at = datetime('now') WHERE id = ?1 AND status = 'open'`,
    )
      .bind(resId)
      .run()
  } catch (err) {
    console.error('[wallet] touchReservation ignoré', err)
  }
}

/**
 * TOP-UP — crédite le wallet de façon IDEMPOTENTE (appelé par le webhook MoR
 * APRÈS vérif de signature + paiement réellement capturé). UNE transaction :
 *   stmt0 — garantit la ligne wallet à 0 (ON CONFLICT DO NOTHING) → le crédit
 *           passe TOUJOURS par l'UPDATE gardé, jamais un INSERT non gardé, et
 *           deux events concurrents sur wallet neuf ne se court-circuitent plus
 *           (fix P4) ; un wallet neuf ne naît jamais négatif (fix B3) ;
 *   stmt1 — crédite, gardé par NOT EXISTS (provider, event_id) ;
 *   stmt2 — ligne ledger, même garde ;
 *   stmt3 — claim de l'event (ON CONFLICT DO NOTHING).
 * Idempotence par event_id seul : Creem renvoie un event_id stable (evt_…) à
 * l'identique sur retry. On NE dédoublonne PAS sur order_id — un refund/dispute
 * partage l'order_id du top-up et doit être traité comme un event distinct.
 * ⚠️ Convention de signe : pour un chargeback/refund sortant, le CALLER passe un
 *    amountMicro NÉGATIF (le SET additionne toujours). Le câblage webhook impose
 *    le signe selon le type d'event — ne jamais laisser un champ libre décider.
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
  const { provider, eventId, email, amountMicro, kind = 'topup' } = params
  const orderId = params.orderId ?? null
  // Fix fuite F-C (audit 14 juin) : le ref_id du ledger pour refund/chargeback
  // DOIT être l'event_id (unique par event), PAS l'order_id. Deux remboursements
  // partiels sur une même commande partagent l'order_id → collision sur l'index
  // unique partiel (ref_type, ref_id, kind WHERE kind IN debit/refund/chargeback)
  // → le batch entier rollback → l'event n'est jamais claimé → retry infini du
  // webhook + 2e remboursement jamais appliqué. Utiliser l'event_id aligne la clé
  // d'unicité du ledger sur celle de webhook_event (la vraie source d'idempotence).
  // topup garde l'order_id (hors index partiel) pour que le refund le retrouve.
  const ledgerRefId = kind === 'topup' ? (orderId ?? eventId) : eventId
  if (!env.DB) return { status: 'error' }
  await ensureWalletTables(env)
  try {
    const res = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO wallet (user_email, balance_micro, currency) VALUES (?1, 0, 'USD')
         ON CONFLICT(user_email) DO NOTHING`,
      ).bind(email),
      env.DB.prepare(
        `UPDATE wallet SET balance_micro = balance_micro + ?2, updated_at = datetime('now')
         WHERE user_email = ?1
           AND NOT EXISTS (SELECT 1 FROM webhook_event WHERE provider = ?3 AND event_id = ?4)`,
      ).bind(email, amountMicro, provider, eventId),
      env.DB.prepare(
        `INSERT INTO credit_ledger (user_email, amount_micro, kind, ref_type, ref_id)
         SELECT ?1, ?2, ?3, 'mor_order', ?4
         WHERE NOT EXISTS (SELECT 1 FROM webhook_event WHERE provider = ?5 AND event_id = ?6)`,
      ).bind(email, amountMicro, kind, ledgerRefId, provider, eventId),
      env.DB.prepare(
        `INSERT INTO webhook_event (provider, event_id, order_id, user_email, amount_micro, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING`,
      ).bind(provider, eventId, orderId, email, amountMicro, kind),
    ])
    const claimed = res[3]?.meta?.changes ?? 0
    return { status: claimed > 0 ? 'credited' : 'duplicate' }
  } catch (err) {
    console.error('[wallet] creditWallet erreur', err)
    return { status: 'error' }
  }
}

export interface ReconcileReport {
  staleSwept: number
  /** wallet.balance ≠ SUM(credit_ledger) → dérive (ne devrait jamais arriver). */
  balanceDrift: { email: string; balanceMicro: number; ledgerMicro: number }[]
  /** réservations 'settled' sans ligne 'debit' (impossible avec le settle atomique). */
  settledWithoutDebit: number
}

/**
 * RÉCONCILIATION — à déclencher par un Cron externe via /api/billing/reconcile
 * (Cloudflare Pages n'a pas de scheduled handler). Trois contrôles :
 *  1) balaie les réservations orphelines (rend les holds gelés) — sûr, idempotent ;
 *  2) détecte les dérives de solde : wallet.balance ≠ SUM(credit_ledger) ;
 *  3) sanity check : réservations 'settled' sans 'debit' (le settle atomique
 *     l'interdit ; non vide = alerte rouge).
 * Ne corrige PAS automatiquement les dérives de SOLDE (de l'argent) — il les
 * REMONTE pour intervention humaine. Seul le sweep mute (sûr).
 */
export async function reconcileWallet(env: Env): Promise<ReconcileReport> {
  const report: ReconcileReport = { staleSwept: 0, balanceDrift: [], settledWithoutDebit: 0 }
  if (!env.DB) return report

  report.staleSwept = await sweepStaleReservations(env, { limit: 500 })

  try {
    const drift = await env.DB.prepare(
      `SELECT w.user_email AS email, w.balance_micro AS balance_micro,
              COALESCE((SELECT SUM(amount_micro) FROM credit_ledger l WHERE l.user_email = w.user_email), 0) AS ledger_micro
       FROM wallet w
       WHERE w.balance_micro != COALESCE(
               (SELECT SUM(amount_micro) FROM credit_ledger l WHERE l.user_email = w.user_email), 0)
       LIMIT 200`,
    ).all<{ email: string; balance_micro: number; ledger_micro: number }>()
    report.balanceDrift = (drift.results ?? []).map((r) => ({
      email: r.email,
      balanceMicro: r.balance_micro,
      ledgerMicro: r.ledger_micro,
    }))
  } catch (err) {
    console.error('[wallet] reconcile — requête dérive échouée', err)
  }

  try {
    const lost = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM reservation r
       WHERE r.status = 'settled'
         AND NOT EXISTS (SELECT 1 FROM credit_ledger l
                         WHERE l.ref_type = 'reservation' AND l.ref_id = r.id AND l.kind = 'debit')`,
    ).first<{ n: number }>()
    report.settledWithoutDebit = lost?.n ?? 0
  } catch (err) {
    console.error('[wallet] reconcile — requête settled-sans-debit échouée', err)
  }

  return report
}

// ─────────────────────────────────────────────────────────────────────
// RÉCONCILIATION (job nocturne — à brancher sur Cron). Le ledger append-only
// n'a de valeur que si on l'utilise pour détecter les dérives silencieuses.
// Requêtes de contrôle (à exécuter et alerter sur résultat non vide) :
//
//   1) Solde cohérent :   SUM(credit_ledger.amount_micro) par user
//      DOIT égaler wallet.balance_micro (au reserved en vol près).
//
//   2) Settle perdu (résa 'settled' sans ligne ledger 'debit' — fenêtre de
//      crash du settle) :
//        SELECT r.id, r.user_email, r.reserved_micro FROM reservation r
//        WHERE r.status='settled'
//          AND NOT EXISTS (SELECT 1 FROM credit_ledger l
//                          WHERE l.ref_type='reservation' AND l.ref_id=r.id AND l.kind='debit');
//      → reserved gelé : re-jouer settleCredits est idempotent (mais l'usage
//        réel est perdu → débiter au montant réservé, ou void selon politique).
//
//   3) Reserved gelé (réservations 'open' anciennes que le sweeper aurait dû
//      void) : SELECT id FROM reservation WHERE status='open'
//              AND updated_at < datetime('now','-1 day');
// ─────────────────────────────────────────────────────────────────────
