-- Deed ERP trusted-browser MFA storage.
-- Safe/idempotent. Stores only a SHA-256 hash of the browser token; never TOTP codes/secrets.
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
    RAISE EXCEPTION 'users.id not found; cannot create user_trusted_browsers';
  END IF;

  IF to_regclass('public.user_trusted_browsers') IS NOT NULL THEN
    NULL;
  ELSIF id_type = 'uuid' THEN
    EXECUTE $sql$
      CREATE TABLE user_trusted_browsers (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        session_version INTEGER NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_ip TEXT,
        last_ip TEXT,
        revoked_at TEXT
      )
    $sql$;
  ELSE
    EXECUTE $sql$
      CREATE TABLE user_trusted_browsers (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        session_version INTEGER NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_ip TEXT,
        last_ip TEXT,
        revoked_at TEXT
      )
    $sql$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_trusted_browsers_user_id ON user_trusted_browsers(user_id);
CREATE INDEX IF NOT EXISTS idx_user_trusted_browsers_expires_at ON user_trusted_browsers(expires_at);

COMMENT ON TABLE user_trusted_browsers IS 'Server-side trusted-browser credentials used to skip repeat MFA challenges for a limited period.';
COMMENT ON COLUMN user_trusted_browsers.token_hash IS 'SHA-256 hash of a random browser token. The plaintext token exists only in an HttpOnly cookie.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deed_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_trusted_browsers TO deed_user;
  END IF;
END $$;
