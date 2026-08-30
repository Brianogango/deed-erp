-- Durable JWT revocation version.
-- Incremented whenever a user's password changes so previously issued JWTs
-- are rejected even across separate application/middleware processes.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

UPDATE users SET session_version = 1 WHERE session_version IS NULL OR session_version < 1;
