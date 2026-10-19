-- Puts repairs that were handed over / closed back to their real status when
-- they show Ready or Invoiced again. Run scripts/repairs-status-health.sql
-- first and read the lists. Deploy the fix (repair saves re-checked when
-- written) BEFORE running this, or an open browser can rewind them again.
--
-- Evidence used, nothing else:
--   * a closing date on the job              → closed
--   * a collection date, or a release order
--     marked released                        → collected
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/repairs-status-fix.sql

\pset null '-'
BEGIN;

CREATE TEMP TABLE fix AS
SELECT r.id, r.job_number AS ref, r.payload->>'status' AS was,
       CASE WHEN nullif(r.payload->>'closedDate', '') IS NOT NULL THEN 'closed' ELSE 'collected' END AS becomes
FROM repairs r
LEFT JOIN outbound_releases o ON o.repair_id = r.id AND o.status::text = 'released'
WHERE r.payload->>'status' IN ('ready', 'invoiced')
  AND (
    nullif(r.payload->>'closedDate', '') IS NOT NULL
    OR nullif(r.payload->>'collectedDate', '') IS NOT NULL
    OR r.collected_date IS NOT NULL
    OR o.id IS NOT NULL
  );

\echo 'Repairs being put back:'
SELECT ref, was, becomes FROM fix ORDER BY ref;

UPDATE repairs r
SET payload = jsonb_set(r.payload, '{status}', to_jsonb(f.becomes)),
    status = 'collected',
    updated_at = now()
FROM fix f
WHERE r.id = f.id;

\echo 'Done. Open screens pick the change up on their next refresh.'
COMMIT;
