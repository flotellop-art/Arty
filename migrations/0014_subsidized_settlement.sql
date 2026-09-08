-- Schema only. No funding, reset, policy row, or activation.
CREATE TABLE IF NOT EXISTS subsidized_settlement_v1 (
  attempt_id TEXT NOT NULL PRIMARY KEY REFERENCES subsidized_attempt_v1(id),
  proof_json TEXT NOT NULL,
  cost_micro_usd INTEGER NOT NULL CHECK (typeof(cost_micro_usd) = 'integer' AND cost_micro_usd BETWEEN 0 AND 9007199254740991),
  settled_at INTEGER NOT NULL CHECK (typeof(settled_at) = 'integer' AND settled_at BETWEEN 0 AND 9007199254740991)
);
