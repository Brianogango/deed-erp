-- Row-based replacement for whole-collection app_state JSON blobs.
-- Normalized Prisma domain tables remain authoritative where they exist.
-- This migration is additive and does not delete legacy app_state data.

CREATE TABLE IF NOT EXISTS erp_state_keys (
  key VARCHAR(160) PRIMARY KEY,
  kind VARCHAR(20) NOT NULL,
  value JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS erp_state_records (
  id TEXT PRIMARY KEY,
  key VARCHAR(160) NOT NULL REFERENCES erp_state_keys(key) ON DELETE CASCADE,
  record_key VARCHAR(240) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_erp_state_record_key UNIQUE (key, record_key)
);

CREATE INDEX IF NOT EXISTS idx_erp_state_keys_updated
  ON erp_state_keys (updated_at);

CREATE INDEX IF NOT EXISTS idx_erp_state_records_order
  ON erp_state_records (key, position);

CREATE INDEX IF NOT EXISTS idx_erp_state_records_updated
  ON erp_state_records (updated_at);
