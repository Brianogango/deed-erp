-- Read-only. Trade-in (buy-back) and exchange machines that show as "sold".
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/tradein-sold-check.sql
--
-- A trade-in machine is registered as "sold / with customer" (it is still the
-- customer's) and only becomes stock when the buy-back is settled and
-- "Stock items" is pressed (exchanges: when "Complete Exchange" is pressed).
-- Section 1 = waiting for that step (expected). Section 2 = the step was done
-- but the machine is still sold (a fault — send this output).

\pset null '-'

CREATE TEMP TABLE ti_line AS
SELECT 'buy-back'::text AS kind, b.payload->>'ref' AS ref, b.payload->>'status' AS doc_status,
       b.payload->>'customerName' AS customer, left(coalesce(b.payload->>'date', b.payload->>'createdAt', ''), 10) AS date,
       l->>'productName' AS product, sid AS serial_id,
       (b.payload->>'status') = 'stocked' AS done
FROM erp_state_records b
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.payload->'lines') = 'array' THEN b.payload->'lines' ELSE '[]' END) l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]' END) sid
WHERE b.key = 'deed_buyBacks'
UNION ALL
SELECT 'exchange', e.payload->>'ref', e.payload->>'status', e.payload->>'customerName', left(coalesce(e.payload->>'date', e.payload->>'createdAt', ''), 10),
       l->>'productName', sid, (e.payload->>'status') = 'completed'
FROM erp_state_records e
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.payload->'returnLines') = 'array' THEN e.payload->'returnLines' ELSE '[]' END) l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]' END) sid
WHERE e.key = 'deed_clientExchanges';

\echo ''
\echo '1. Trade-ins not finished yet: the machine stays "sold / with customer" until the step shown is done'
SELECT t.kind, t.ref, t.date, t.customer, t.product, s.serial_number, t.doc_status,
       CASE t.kind
         WHEN 'buy-back' THEN CASE t.doc_status
           WHEN 'draft' THEN 'Approve, then pay or add as credit, then Stock items'
           WHEN 'approved' THEN 'Pay or add as credit, then Stock items'
           WHEN 'paid' THEN 'Press Stock items'
           ELSE 'Cancelled / other' END
         ELSE CASE t.doc_status WHEN 'approved' THEN 'Press Complete Exchange' WHEN 'cancelled' THEN 'Cancelled' ELSE 'Approve, then Complete Exchange' END
       END AS next_step
FROM ti_line t LEFT JOIN serial_numbers s ON s.id::text = t.serial_id
WHERE NOT t.done
ORDER BY t.date, t.ref;

\echo ''
\echo '2. Finished trade-ins whose machine is STILL sold (should be in stock) — send this section'
SELECT t.kind, t.ref, t.date, t.customer, t.product, s.serial_number, s.status::text AS serial_status, s.location, s.updated_at::timestamp(0) AS serial_changed
FROM ti_line t LEFT JOIN serial_numbers s ON s.id::text = t.serial_id
WHERE t.done AND (s.id IS NULL OR s.status::text = 'sold' OR s.location = 'customer')
ORDER BY t.date, t.ref;

\echo ''
\echo '3. Totals'
SELECT t.kind, count(*) FILTER (WHERE NOT t.done) AS waiting_for_last_step,
       count(*) FILTER (WHERE t.done AND s.status::text NOT IN ('sold') AND s.location <> 'customer') AS in_stock_ok,
       count(*) FILTER (WHERE t.done AND (s.id IS NULL OR s.status::text = 'sold' OR s.location = 'customer')) AS finished_but_still_sold
FROM ti_line t LEFT JOIN serial_numbers s ON s.id::text = t.serial_id
GROUP BY t.kind;
