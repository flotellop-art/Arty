-- Durable refund / chargeback accounting for prepaid wallets.
--
-- A reversal may arrive before checkout.completed, or while credits are held
-- by an in-flight AI reservation. Keeping requested and collected amounts
-- separately prevents either ordering from silently losing the outstanding
-- debit. Individual collections remain append-only in credit_ledger.

CREATE TABLE IF NOT EXISTS wallet_reversal (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  user_email TEXT,
  kind TEXT NOT NULL,
  ratio_numerator INTEGER NOT NULL,
  ratio_denominator INTEGER NOT NULL,
  requested_micro INTEGER,
  collected_micro INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'awaiting_topup',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_reversal_order
  ON wallet_reversal(provider, order_id, status);

CREATE INDEX IF NOT EXISTS idx_wallet_reversal_user
  ON wallet_reversal(user_email, status, created_at);
