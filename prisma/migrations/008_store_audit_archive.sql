-- P0-SEC-002: archive displaced store-sync audit timeline rows.
-- Additive only. Rollback: DROP TABLE IF EXISTS store_audit_archive;

CREATE TABLE IF NOT EXISTS store_audit_archive (
  id          TEXT PRIMARY KEY,
  entry_id    VARCHAR(80) NOT NULL,
  at          TIMESTAMPTZ NOT NULL,
  actor_id    VARCHAR(80),
  actor_name  VARCHAR(200),
  actor_role  VARCHAR(60),
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_audit_archive_at ON store_audit_archive (at);
CREATE INDEX IF NOT EXISTS idx_store_audit_archive_entry ON store_audit_archive (entry_id);
