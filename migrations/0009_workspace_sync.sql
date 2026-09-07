-- Not applied remotely. 0008 is reserved by the independent credit checkout work.
-- Registry generations and historical enrollment IDs are never implicitly reset.
CREATE TABLE workspace_sync_subjects_v1 (
  subject_hash TEXT PRIMARY KEY, generation TEXT NOT NULL, erasure_ticket TEXT
);
CREATE TABLE workspace_sync_enrollments_v1 (
  subject_hash TEXT NOT NULL, enrollment_id TEXT NOT NULL, generation TEXT NOT NULL,
  vault_id TEXT NOT NULL UNIQUE, epoch TEXT NOT NULL UNIQUE,
  PRIMARY KEY (subject_hash, enrollment_id)
);
CREATE TABLE workspace_sync_vaults_v1 (
  vault_id TEXT PRIMARY KEY, epoch TEXT NOT NULL UNIQUE, subject_hash TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  head TEXT, sequence INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
  operations INTEGER NOT NULL DEFAULT 0, purged INTEGER NOT NULL DEFAULT 0 CHECK(purged IN (0,1)),
  CHECK(sequence >= 0 AND bytes >= 0 AND operations >= 0)
);
CREATE UNIQUE INDEX workspace_sync_active_subject_v1 ON workspace_sync_vaults_v1(subject_hash) WHERE revoked = 0;
CREATE TABLE workspace_sync_operations_v1 (
  vault_id TEXT NOT NULL, epoch TEXT NOT NULL, operation_id TEXT NOT NULL,
  expected_head TEXT, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved','uploaded','published','conflict')),
  sequence INTEGER, commit_ticket TEXT, cleaned INTEGER NOT NULL DEFAULT 0 CHECK(cleaned IN (0,1)),
  PRIMARY KEY(vault_id, operation_id), UNIQUE(vault_id, sequence),
  CHECK(bytes > 129 AND bytes <= 17825792)
);
CREATE TABLE workspace_sync_uploads_v1 (
  attempt_id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1))
);
CREATE INDEX workspace_sync_uploads_pending_v1 ON workspace_sync_uploads_v1(vault_id, settled);
CREATE TABLE workspace_sync_erasure_targets_v1 (
  operation_id TEXT NOT NULL, vault_id TEXT NOT NULL, epoch TEXT NOT NULL,
  PRIMARY KEY(operation_id, vault_id)
);
