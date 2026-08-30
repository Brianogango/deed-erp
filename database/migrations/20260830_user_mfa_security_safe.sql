-- Deed ERP privileged MFA storage.
-- Safe/idempotent: creates a separate table without altering existing users.

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  enrolled_at TEXT,
  last_used_step BIGINT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_enabled ON user_mfa(enabled);

COMMENT ON TABLE user_mfa IS 'Encrypted TOTP MFA material for ERP users. Never expose secret_enc to browser/client APIs.';
COMMENT ON COLUMN user_mfa.secret_enc IS 'AES-256-GCM ciphertext; key is held only in MFA_ENCRYPTION_KEY environment secret.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deed_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_mfa TO deed_user;
  END IF;
END $$;
