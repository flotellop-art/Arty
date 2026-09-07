-- Preparatory only: not applied remotely, no policy row or route activation.
-- 0012 is reserved by the separate, unpublished Creem candidate.
-- One cumulative funding scope, independent of identity, hostname and date.
CREATE TABLE IF NOT EXISTS subsidized_budget_v1 (
  scope TEXT NOT NULL PRIMARY KEY CHECK (scope = 'arty-subsidized'),
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (typeof(enabled) = 'integer' AND enabled IN (0, 1)),
  limit_micro_usd INTEGER NOT NULL CHECK (typeof(limit_micro_usd) = 'integer' AND limit_micro_usd BETWEEN 0 AND 9007199254740991),
  limit_attempts INTEGER NOT NULL CHECK (typeof(limit_attempts) = 'integer' AND limit_attempts BETWEEN 0 AND 9007199254740991),
  reserved_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_micro_usd) = 'integer' AND reserved_micro_usd BETWEEN 0 AND limit_micro_usd),
  reserved_attempts INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_attempts) = 'integer' AND reserved_attempts BETWEEN 0 AND limit_attempts),
  pending_admission_id TEXT
);

CREATE TABLE IF NOT EXISTS subsidized_attempt_v1 (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  scope TEXT NOT NULL CHECK (scope = 'arty-subsidized') REFERENCES subsidized_budget_v1(scope),
  policy_revision INTEGER NOT NULL CHECK (typeof(policy_revision) = 'integer' AND policy_revision BETWEEN 1 AND 9007199254740991),
  ceiling_micro_usd INTEGER NOT NULL CHECK (typeof(ceiling_micro_usd) = 'integer' AND ceiling_micro_usd BETWEEN 1 AND 9007199254740991),
  envelope_id TEXT NOT NULL CHECK (length(envelope_id) BETWEEN 1 AND 96),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'engaged')),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at BETWEEN 0 AND 9007199254740991),
  engaged_at INTEGER CHECK (engaged_at IS NULL OR (typeof(engaged_at) = 'integer' AND engaged_at BETWEEN created_at AND 9007199254740991)),
  CHECK ((state = 'reserved' AND engaged_at IS NULL) OR (state = 'engaged' AND engaged_at IS NOT NULL))
);
