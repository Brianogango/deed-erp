-- Partner (reseller) API keys for the public catalog API (/api/public/v1/*).
-- Additive only — safe to run on a live database.
CREATE TABLE IF NOT EXISTS partner_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         varchar(120) NOT NULL,
  prefix       varchar(16)  NOT NULL,
  key_hash     varchar(64)  NOT NULL UNIQUE,
  is_active    boolean      NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id),
  created_at   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at timestamp(3),
  revoked_at   timestamp(3)
);

CREATE INDEX IF NOT EXISTS idx_partner_api_keys_hash ON partner_api_keys (key_hash);
