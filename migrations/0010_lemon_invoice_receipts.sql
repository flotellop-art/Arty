-- Additive only. No subscription backfill, account association or money movement.
-- Observations are NOT a payments ledger. Different notifications/serializations
-- can describe the same payment, and refunded_minor is a cumulative invoice state.
CREATE TABLE IF NOT EXISTS lemon_invoice_receipt_v1 (
  receipt_hash TEXT PRIMARY KEY NOT NULL,
  event_name TEXT NOT NULL,
  invoice_id TEXT,
  subscription_id TEXT,
  store_id TEXT,
  customer_id TEXT,
  test_mode INTEGER CHECK (test_mode IN (0, 1)),
  invoice_status TEXT,
  currency TEXT,
  total_minor INTEGER CHECK (total_minor >= 0),
  refunded_minor INTEGER CHECK (refunded_minor >= 0),
  refunded INTEGER CHECK (refunded IN (0, 1)),
  provider_refunded_at TEXT,
  provider_updated_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('captured', 'review')),
  reason TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lemon_invoice_receipt_scope
  ON lemon_invoice_receipt_v1(store_id, test_mode, invoice_id, received_at);
