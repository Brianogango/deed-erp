-- Put a retired screen copy back (undo scripts/retire-frozen-copies.sql for
-- one copy). Pass the copy's name, e.g. -v key=deed_invoices.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v key=deed_invoices -d "$DB" < scripts/restore-frozen-copy.sql

BEGIN;

INSERT INTO erp_state_keys (key, kind, version, created_at, updated_at)
SELECT :'key', 'collection', 1, now(), now()
WHERE EXISTS (SELECT 1 FROM retired_screen_copies WHERE key = :'key' AND record_key <> 'app_state')
ON CONFLICT (key) DO UPDATE SET version = erp_state_keys.version + 1, updated_at = now();

INSERT INTO erp_state_records (id, key, record_key, position, payload, created_at, updated_at)
SELECT md5(random()::text || r.record_key), r.key, r.record_key, r.position, r.payload, coalesce(r.created_at, now()), now()
FROM retired_screen_copies r
WHERE r.key = :'key' AND r.record_key <> 'app_state'
ON CONFLICT (key, record_key) DO NOTHING;

DELETE FROM retired_screen_copies WHERE key = :'key';

COMMIT;

SELECT :'key' AS restored, count(*) AS rows FROM erp_state_records WHERE key = :'key';
