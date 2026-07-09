-- Instant store sync: NOTIFY on every app_state write so the app's SSE streams
-- can push changes to connected clients immediately instead of polling every
-- 10 seconds. Safe to run repeatedly. Run as a role that owns app_state
-- (postgres), e.g.:  sudo -u postgres psql deed_erp -f <this file>

CREATE OR REPLACE FUNCTION app_state_notify() RETURNS trigger AS $$
BEGIN
  -- Payload is informational only (subscribers re-check their own cursor);
  -- keep it under the 8000-byte NOTIFY limit.
  PERFORM pg_notify('app_state_changed', left(NEW.key, 7900));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_state_notify_trigger ON app_state;
CREATE TRIGGER app_state_notify_trigger
AFTER INSERT OR UPDATE ON app_state
FOR EACH ROW EXECUTE FUNCTION app_state_notify();
