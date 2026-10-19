-- Read-only. Repairs that were released / collected / closed but now show Ready.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/repairs-status-health.sql > /tmp/repairs-status.txt
--   less -S /tmp/repairs-status.txt

\pset null '-'

CREATE TEMP VIEW rp AS
SELECT r.id, r.job_number AS ref, r.status::text AS column_status,
       r.payload->>'status' AS shown_status,
       r.collected_date,
       nullif(r.payload->>'collectedDate', '') AS payload_collected,
       nullif(r.payload->>'closedDate', '') AS payload_closed,
       nullif(r.payload->>'invoiceId', '') AS invoice_id,
       r.payload->>'customerName' AS customer,
       r.payload->'statusHistory' AS history,
       r.updated_at
FROM repairs r WHERE r.payload IS NOT NULL;

\echo '1. Shown status against the table status'
SELECT shown_status, column_status, count(*) FROM rp GROUP BY 1, 2 ORDER BY 1, 2;

\echo ''
\echo '2. Shown Ready / Invoiced, but the release order says the device was handed over'
SELECT rp.ref, rp.customer, rp.shown_status, rp.column_status, o.ref AS release, o.status::text AS release_status, o.released_at::date AS released
FROM rp JOIN outbound_releases o ON o.repair_id = rp.id
WHERE rp.shown_status IN ('ready', 'invoiced') AND o.status::text IN ('released', 'verified')
ORDER BY o.released_at DESC NULLS LAST;

\echo ''
\echo '3. Shown Ready / Invoiced, but carrying a collection or closing date'
SELECT ref, customer, shown_status, column_status, collected_date::date AS col_collected, left(payload_collected, 10) AS collected, left(payload_closed, 10) AS closed, updated_at::date AS last_saved
FROM rp
WHERE shown_status IN ('ready', 'invoiced') AND (collected_date IS NOT NULL OR payload_collected IS NOT NULL OR payload_closed IS NOT NULL)
ORDER BY updated_at DESC;

\echo ''
\echo '4. Shown Ready / Invoiced, but the history says it went further (last 4 steps)'
SELECT rp.ref, rp.customer, rp.shown_status,
       (SELECT string_agg(coalesce(h->>'status', '?') || ' ' || left(coalesce(h->>'date', h->>'at', ''), 16) || ' ' || coalesce(h->>'by', h->>'changedBy', ''), '  →  ' ORDER BY ord)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(rp.history) = 'array' THEN rp.history ELSE '[]'::jsonb END) WITH ORDINALITY AS t(h, ord)
          WHERE ord > jsonb_array_length(CASE WHEN jsonb_typeof(rp.history) = 'array' THEN rp.history ELSE '[]'::jsonb END) - 4) AS last_steps
FROM rp
WHERE rp.shown_status IN ('ready', 'invoiced')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(rp.history) = 'array' THEN rp.history ELSE '[]'::jsonb END) h
              WHERE h->>'status' IN ('verified_released', 'delivered', 'collected', 'closed'))
ORDER BY rp.updated_at DESC;

\echo ''
\echo '5. Ready / Invoiced repairs by month booked (how many are waiting for collection)'
SELECT left(coalesce(r.payload->>'intakeDate', r.payload->>'createdDate', ''), 7) AS month, r.payload->>'status' AS shown_status, count(*)
FROM repairs r
WHERE r.payload->>'status' IN ('ready', 'invoiced')
GROUP BY 1, 2 ORDER BY 1 DESC;
