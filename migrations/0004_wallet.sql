-- Migration 0004 — Wallet & crédits prépayés (Track A)
-- Date : 2026-06-07
-- Objet : tables D1 pour le ledger de crédits prépayés.
--         Unité = micro-USD PARTOUT (1 crédit = 1 µ$ de droit de tirage au prix
--         Arty markupé), cohérent avec cost_usd_micro (quota.ts / pricing.ts).
--         Une seule unité = zéro bug de conversion. "Crédits" reste un habillage
--         marketing côté client, jamais une unité en base.
--
--         Modèle réserve/settle : on réserve un coût ESTIMÉ avant l'appel IA, on
--         règle le coût RÉEL après le stream. credit_ledger (append-only) est la
--         source de vérité comptable ; wallet est le cache atomique du hot path.
--
--   Décisions validées (cf. plan crédits, 7 juin 2026) :
--     - Échec D1 sur le path wallet : fail-closed gradué par modalité
--       (image = refus strict, texte faible coût = fail-open plafonné).
--     - Fiabilité du débit : retry + réconciliation nocturne
--       (résiduel ~1 appel accepté explicitement).
--     - Pas d'expiration sur les crédits payés (droit conso EU) ;
--       le breakage est un passif, JAMAIS du revenu.

-- =====================================================================
-- TABLE 1 : wallet
-- Solde matérialisé, lu/écrit sur le hot path des appels IA.
-- Une ligne par utilisateur. Disponible réel = balance_micro - reserved_micro.
-- balance_micro peut devenir légèrement négatif (dépassement borné à 1 appel,
-- ou suite à un chargeback) ; reserved_micro reste toujours >= 0 (clamp en code).
-- =====================================================================
CREATE TABLE IF NOT EXISTS wallet (
  user_email TEXT PRIMARY KEY,
  balance_micro INTEGER NOT NULL DEFAULT 0,
  reserved_micro INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
    -- figé au 1er top-up, un wallet ne mélange jamais deux devises
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- TABLE 2 : credit_ledger
-- Journal append-only — source de vérité comptable. JAMAIS d'UPDATE/DELETE.
-- Chaque mouvement = une ligne signée :
--   amount_micro > 0 → crédit (topup, refund entrant, bonus, migration)
--   amount_micro < 0 → débit (settle d'un appel, chargeback, expiry de bonus)
-- =====================================================================
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  amount_micro INTEGER NOT NULL,
  kind TEXT NOT NULL,
    -- 'topup' | 'debit' | 'refund' | 'chargeback' | 'expiry' | 'admin_adjust' | 'migration'
  ref_type TEXT,
    -- 'mor_order' | 'reservation' | 'premium_pack' ...
  ref_id TEXT,
  provider_cost_micro INTEGER,
    -- coût fournisseur BRUT (pour le calcul de marge) ; NULL pour les top-ups
  model TEXT,
  modality TEXT,
    -- 'text' | 'image'
  meta TEXT,
    -- JSON libre (tokens input/output/cache, markup_bps, etc.)
  balance_after INTEGER,
    -- snapshot du solde après ce mouvement (audit / debug / réconciliation)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_email
  ON credit_ledger(user_email, created_at);

-- Garantit qu'une même réservation n'est débitée/remboursée qu'UNE seule fois
-- (idempotence du settle, même en cas de retry ou de race settle <-> sweeper).
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_settle_once
  ON credit_ledger(ref_type, ref_id, kind)
  WHERE kind IN ('debit', 'refund', 'chargeback');

-- =====================================================================
-- TABLE 3 : webhook_event
-- Idempotence des events MoR (Creem / Lemon Squeezy). La PRÉSENCE d'une ligne
-- = "event déjà traité". Un crédit étant ADDITIF, il DOIT être conditionné par
-- l'insertion gagnante de cette ligne — sinon un replay d'event signé = crédits
-- gratuits infinis (contrairement à INSERT OR REPLACE, sûr seulement pour un
-- statut idempotent comme un abonnement).
-- =====================================================================
CREATE TABLE IF NOT EXISTS webhook_event (
  provider TEXT NOT NULL,
    -- 'creem' | 'lemonsqueezy'
  event_id TEXT NOT NULL,
    -- id natif unique de l'event chez le MoR
  order_id TEXT,
  user_email TEXT,
  amount_micro INTEGER,
  kind TEXT,
    -- 'topup' | 'refund' | 'chargeback'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, event_id)
);

-- Filet : certains MoR ré-émettent un retry avec un nouvel event_id mais le
-- même order_id (LS n'expose pas d'event_id stable → l'idempotence porte alors
-- sur order_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_event_order
  ON webhook_event(provider, order_id)
  WHERE order_id IS NOT NULL;

-- =====================================================================
-- TABLE 4 : reservation
-- Pré-autorisations en vol (réserve/settle). Une ligne par appel IA sur le
-- path wallet. État : 'open' → 'settled' | 'voided'.
-- Un crash entre la réserve et le settle laisse la ligne en 'open' → elle est
-- balayée par le sweeper (void + restitution de reserved_micro) après délai.
-- =====================================================================
CREATE TABLE IF NOT EXISTS reservation (
  id TEXT PRIMARY KEY,
    -- UUID généré côté Worker avant l'INSERT
  user_email TEXT NOT NULL,
  reserved_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
    -- 'open' | 'settled' | 'voided'
  model TEXT,
  modality TEXT,
    -- 'text' | 'image'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at TEXT
);

-- Pour le sweeper : retrouver les réservations 'open' trop anciennes.
CREATE INDEX IF NOT EXISTS idx_reservation_sweep
  ON reservation(status, created_at);
