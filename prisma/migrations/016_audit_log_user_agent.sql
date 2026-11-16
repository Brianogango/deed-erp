-- Who did what, from where, on what: audit_logs already keeps the address the
-- change came from; this adds the browser that made it, so a job's log can
-- name the machine as far as a browser reveals it (operating system and
-- browser; a phone model where the browser sends one).
--
-- Apply with the helper, which reads the connection string out of .env and
-- runs as the OS postgres role that owns the tables:
--
--   cd /var/www/deed-erp
--   sudo bash scripts/apply-sql-as-postgres.sh prisma/migrations/016_audit_log_user_agent.sql
--
-- (psql "$DATABASE_URL" does not work from a root shell: the variable lives
-- in the app's .env, not in the environment, and the app's DB user does not
-- own the table.)
--
-- Existing rows keep NULL and read as "Unknown device"; nothing backfills them.
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS user_agent text;
