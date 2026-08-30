-- Deed ERP privileged MFA storage.
-- Safe/idempotent: creates a separate table without altering existing users.
-- user_id type must match live users.id (UUID on Contabo, TEXT in some local/e2e schemas).

DO $$
DECLARE
  id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'users'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF id_type IS NULL THEN
    RAISE EXCEPTION 'users.id not found; cannot create user_mfa';
  END IF;

  IF to_regclass('public.user_mfa') IS NOT NULL THEN
    NULL;
  ELSIF id_type = 'uuid' THEN
    EXECUTE $sql$
      CREATE TABLE user_mfa (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret_enc TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT false,
        enrolled_at TEXT,
        last_used_step BIGINT,
        updated_at TEXT NOT NULL
      )
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE TABLE user_mfa (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret_enc TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT false,
        enrolled_at TEXT,
        last_used_step BIGINT,
        updated_at TEXT NOT NULL
      )
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_mfa_enabled ON user_mfa(enabled);

COMMENT ON TABLE user_mfa IS 'Encrypted TOTP MFA material for ERP users. Never expose secret_enc to browser/client APIs.';
COMMENT ON COLUMN user_mfa.secret_enc IS 'AES-256-GCM ciphertext; key is held only in MFA_ENCRYPTION_KEY environment secret.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deed_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_mfa TO deed_user;
  END IF;
END $$;
