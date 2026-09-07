-- Additive, non-unique lookup only. No financial/history repair or intent migration.
CREATE INDEX IF NOT EXISTS idx_webhook_event_order_topup
  ON webhook_event(provider, order_id, kind, user_email);
