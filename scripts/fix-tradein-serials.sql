-- Puts finished trade-in machines that still show "sold" back into stock,
-- exactly where the trade-in stocked them:
--   buy-back "stocked"    → available at the buy-back's destination
--                           (refurbishment when the line's condition was poor)
--   exchange "completed"  → available at the shop (With Issues), as
--                           Complete Exchange does
--
-- PREVIEW (changes nothing):
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/fix-tradein-serials.sql
-- APPLY:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v apply=1 -P pager=off -d "$DB" < scripts/fix-tradein-serials.sql
--
-- Only serials still "sold / with customer" are touched; one sold again
-- since (a later sale) is listed and left alone.

\pset null '-'
BEGIN;

CREATE TEMP TABLE fix_line ON COMMIT DROP AS
SELECT 'buy-back'::text AS kind, b.payload->>'ref' AS ref, b.payload->>'customerName' AS customer,
       left(coalesce(b.payload->>'stockedDate', b.payload->>'date', ''), 10) AS done_on,
       sid AS serial_id,
       CASE WHEN l->>'condition' = 'poor' THEN 'refurbishment' ELSE 'in_stock' END AS new_status,
       coalesce(nullif(b.payload->>'destinationLocation', ''), 'warehouse') AS new_location
FROM erp_state_records b
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.payload->'lines') = 'array' THEN b.payload->'lines' ELSE '[]' END) l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]' END) sid
WHERE b.key = 'deed_buyBacks' AND b.payload->>'status' = 'stocked'
UNION ALL
SELECT 'exchange', e.payload->>'ref', e.payload->>'customerName', left(coalesce(e.payload->>'completedDate', e.payload->>'date', ''), 10),
       sid, 'in_stock', 'shop'
FROM erp_state_records e
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.payload->'returnLines') = 'array' THEN e.payload->'returnLines' ELSE '[]' END) l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]' END) sid
WHERE e.key = 'deed_clientExchanges' AND e.payload->>'status' = 'completed';

-- A serial sold to someone after the trade-in was stocked is a real sale.
CREATE TEMP TABLE fix_target ON COMMIT DROP AS
SELECT f.*, s.id AS sn_id, s.serial_number, s.status::text AS old_status, s.location AS old_location,
       s.screen_extras->>'saleOrderId' AS sale_ref, s.screen_extras->>'soldDate' AS sold_on,
       coalesce(left(s.screen_extras->>'soldDate', 10) > f.done_on, false) AS sold_after
FROM fix_line f JOIN serial_numbers s ON s.id::text = f.serial_id
WHERE s.removed_at IS NULL AND (s.status::text = 'sold' OR s.location = 'customer');

\echo '1. Machines that go back into stock'
SELECT kind, ref, done_on, customer, serial_number, old_status || ' / ' || coalesce(old_location, '-') AS now_, new_status || ' / ' || new_location AS becomes
FROM fix_target WHERE NOT sold_after ORDER BY done_on, ref;

\echo '2. Left alone: sold again after the trade-in (check these by hand)'
SELECT kind, ref, done_on, customer, serial_number, sold_on, sale_ref FROM fix_target WHERE sold_after ORDER BY done_on;

\if :{?apply}
  UPDATE serial_numbers s
  SET status = t.new_status,
      location = t.new_location,
      screen_extras = CASE WHEN s.screen_extras IS NULL THEN NULL ELSE s.screen_extras - 'soldDate' - 'saleOrderId' END,
      updated_at = now()
  FROM fix_target t
  WHERE s.id = t.sn_id AND NOT t.sold_after;

  -- Open screens reload their serial list.
  SELECT pg_notify('app_state_changed', 'deed_serials');
  COMMIT;
  \echo 'Done.'
\else
  ROLLBACK;
  \echo 'Preview only — nothing changed. Add -v apply=1 to apply.'
\endif

\echo ''
\echo '3. Everything else changed in the same minute as the four (8 Oct 10:09) — to see whether one save rewrote many serials'
SELECT count(*) AS serials_changed_10_09, count(*) FILTER (WHERE status = 'sold') AS now_sold
FROM serial_numbers WHERE updated_at >= '2026-10-08 10:09:00' AND updated_at < '2026-10-08 10:10:00';
