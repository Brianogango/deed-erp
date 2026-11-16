-- Who did what, from where, on what: audit_logs already keeps the address the
-- change came from; this adds the browser that made it, so a job's log can
-- name the machine as far as a browser reveals it (operating system and
-- browser; a phone model where the browser sends one).
--
-- Apply BEFORE deploying the code that writes it. Existing rows keep NULL and
-- read as "Unknown device"; nothing backfills them.
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS user_agent text;
