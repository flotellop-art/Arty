-- Migration 0002 — Monétisation Lemon Squeezy
-- Date : 2026-04-25
-- Objet : tables D1 pour gérer abonnements, licences à vie et packs premium
--         vendus via Lemon Squeezy (Merchant of Record).
--         Produits gérés :
--           - Arty Subscription (1004478) — 9.99€/mois, abonnement récurrent
--           - Arty Pro          (1004485) — 39€ one-time, licence à vie 3 appareils
--           - Pack Premium      (1004493) — 1.99€ pour 100 messages premium

-- =====================================================================
-- TABLE 1 : subscriptions
-- Suit l'état d'abonnement Lemon Squeezy de chaque utilisateur.
-- Une ligne par souscription LS (un user peut avoir plusieurs lignes
-- au fil du temps si annulation puis réabonnement).
-- =====================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  ls_subscription_id TEXT UNIQUE,
  ls_customer_id TEXT,
  ls_variant_id TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
    -- 'active' | 'inactive' | 'cancelled' | 'expired' | 'past_due'
  plan_type TEXT NOT NULL DEFAULT 'free',
    -- 'free' | 'subscription' | 'pro' | 'vip'
  current_period_end TEXT,
    -- date ISO 8601 (ex : '2026-05-25T12:34:56Z')
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_email
  ON subscriptions(user_email);

CREATE INDEX IF NOT EXISTS idx_subscriptions_ls_subscription_id
  ON subscriptions(ls_subscription_id);

-- =====================================================================
-- TABLE 2 : licenses
-- Licences à vie (Arty Pro). Une ligne par achat one-time avec
-- compteur d'activations pour limiter le nombre d'appareils.
-- =====================================================================
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  ls_order_id TEXT UNIQUE,
  ls_product_id TEXT,
  activation_count INTEGER NOT NULL DEFAULT 0,
  max_activations INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active',
    -- 'active' | 'disabled' | 'expired'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_licenses_user_email
  ON licenses(user_email);

CREATE INDEX IF NOT EXISTS idx_licenses_license_key
  ON licenses(license_key);

-- =====================================================================
-- TABLE 3 : premium_packs
-- Packs de messages premium one-time (1.99€ / 100 messages).
-- Le compteur messages_used s'incrémente à chaque message premium
-- consommé jusqu'à atteindre messages_total.
-- =====================================================================
CREATE TABLE IF NOT EXISTS premium_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  ls_order_id TEXT UNIQUE NOT NULL,
  messages_total INTEGER NOT NULL DEFAULT 100,
  messages_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_premium_packs_user_email
  ON premium_packs(user_email);
