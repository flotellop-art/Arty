-- Arty D1 Database Schema — ROLLUP DOCUMENTAIRE (régénéré le 3 juillet 2026,
-- audit F-12). La SOURCE DE VÉRITÉ reste les `CREATE TABLE IF NOT EXISTS`
-- exécutés au runtime par chaque endpoint (pattern BUG 38 — self-healing) ;
-- ce fichier sert à provisionner/documenter une base neuve, pas à migrer.
-- En cas de divergence, c'est le code sous functions/ qui fait foi.

-- ── Mémoire utilisateur (functions/api/memory/action.ts) ──
CREATE TABLE IF NOT EXISTS memory (
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'profil', 'clients', 'projets', 'notes'
  data TEXT NOT NULL,      -- JSON content
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, category)
);
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(user_id);

-- ── Quotas & usage (server-key uniquement, BYOK non compté) ──
-- functions/api/_lib/quota.ts
CREATE TABLE IF NOT EXISTS quota (
  email TEXT NOT NULL,
  day TEXT NOT NULL,           -- 'YYYY-MM-DD' UTC
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (email, day)
);
CREATE TABLE IF NOT EXISTS quota_model (
  email TEXT NOT NULL,
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  audio_seconds INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, day, model)
);
-- functions/api/_lib/freeQuota.ts (plan free : quota journalier par famille)
CREATE TABLE IF NOT EXISTS free_daily_quota (
  email TEXT NOT NULL,
  day TEXT NOT NULL,
  family TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, day, family)
);
-- functions/api/_lib/checkPremiumCap.ts (cap mensuel premium, atomique)
CREATE TABLE IF NOT EXISTS premium_cap (
  email TEXT NOT NULL,
  month TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, month, bucket)
);
-- functions/api/ai/memory-extract.ts + share/index.ts (tâches background 5/j)
CREATE TABLE IF NOT EXISTS bg_quota (
  email TEXT NOT NULL,
  day TEXT NOT NULL,
  task TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, day, task)
);
-- functions/api/checkout/creem.ts (anti-abus création de checkouts)
CREATE TABLE IF NOT EXISTS checkout_quota (
  email TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, day)
);

-- ── Essai gratuit (compte Google) — functions/api/_lib/checkAllowedUser.ts ──
CREATE TABLE IF NOT EXISTS trial_usage (
  email TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- ── Essai par email (OTP) — functions/api/_lib/emailTrial.ts ──
CREATE TABLE IF NOT EXISTS email_otp (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_trial_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS email_trial_usage (
  email TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_rate (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

-- ── Facturation : abonnements & licences — functions/api/webhook/lemonsqueezy.ts ──
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  ls_subscription_id TEXT UNIQUE,
  ls_customer_id TEXT,
  ls_variant_id TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
  plan_type TEXT NOT NULL DEFAULT 'free',
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  license_key TEXT UNIQUE NOT NULL,
  ls_order_id TEXT UNIQUE,
  ls_product_id TEXT,
  activation_count INTEGER NOT NULL DEFAULT 0,
  max_activations INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_licenses_user_email ON licenses(user_email);
CREATE TABLE IF NOT EXISTS premium_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  ls_order_id TEXT UNIQUE NOT NULL,
  messages_total INTEGER NOT NULL DEFAULT 100,
  messages_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_premium_packs_user_email ON premium_packs(user_email);

-- ── Wallet crédits (pay-as-you-go) — functions/api/_lib/wallet.ts ──
CREATE TABLE IF NOT EXISTS wallet (
  user_email TEXT PRIMARY KEY,
  balance_micro INTEGER NOT NULL DEFAULT 0,
  reserved_micro INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  amount_micro INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref_type TEXT, ref_id TEXT,
  provider_cost_micro INTEGER,
  model TEXT, modality TEXT, meta TEXT,
  balance_after INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_email
  ON credit_ledger(user_email, created_at);
CREATE TABLE IF NOT EXISTS reservation (
  id TEXT PRIMARY KEY, user_email TEXT NOT NULL,
  reserved_micro INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  model TEXT, modality TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reservation_sweep
  ON reservation(status, updated_at);
CREATE TABLE IF NOT EXISTS webhook_event (
  provider TEXT NOT NULL, event_id TEXT NOT NULL,
  order_id TEXT, user_email TEXT, amount_micro INTEGER, kind TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, event_id)
);

-- ── Partage public de conversations — functions/api/share/index.ts ──
CREATE TABLE IF NOT EXISTS shared_conversations (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  has_google_data INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_shared_owner ON shared_conversations(owner_email);
