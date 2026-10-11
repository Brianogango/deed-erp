-- Read-only. Why some delivery notes do not reach delivery_notes:
-- 1. numbers used by two notes, 2. notes linking a serial the serials table lacks.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/delivery-notes-clash-check.sql

\echo '1a. Numbers the screens use for more than one delivery note'
SELECT r.payload->>'ref' AS dn_number, count(*) AS notes,
       string_agg(left(r.payload->>'id', 8) || ' ' || coalesce(r.payload->>'status', '?') || ' ' || coalesce(r.payload->>'saleOrderRef', '-') || ' ' || coalesce(r.payload->>'customerName', '-'), ' | ') AS which
FROM erp_state_records r
WHERE r.key = 'deed_deliveries' AND coalesce(r.payload->>'ref', '') <> ''
GROUP BY 1 HAVING count(*) > 1 ORDER BY 1;

\echo '1b. Table rows holding a number under a different id than the screens'
SELECT t.dn_number, left(t.id::text, 8) AS table_id, t.status AS table_status, t.sale_order_ref AS table_so, t.customer_name AS table_customer,
       left(r.payload->>'id', 8) AS screen_id, r.payload->>'status' AS screen_status, r.payload->>'saleOrderRef' AS screen_so, r.payload->>'customerName' AS screen_customer,
       EXISTS (SELECT 1 FROM erp_state_records x WHERE x.key = 'deed_deliveries' AND x.payload->>'id' = t.id::text) AS table_row_still_on_screens
FROM delivery_notes t
JOIN erp_state_records r ON r.key = 'deed_deliveries' AND r.payload->>'ref' = t.dn_number AND r.payload->>'id' <> t.id::text
ORDER BY t.dn_number;

\echo '2. Delivery-note lines pointing at a serial the serials table does not have'
SELECT r.payload->>'ref' AS dn_number, l->>'productName' AS product, s AS serial_id
FROM erp_state_records r,
     jsonb_array_elements(CASE WHEN jsonb_typeof(r.payload->'lines') = 'array' THEN r.payload->'lines' ELSE '[]'::jsonb END) l,
     jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]'::jsonb END) s
WHERE r.key = 'deed_deliveries'
  AND s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (SELECT 1 FROM serial_numbers sn WHERE sn.id::text = s)
ORDER BY 1;
