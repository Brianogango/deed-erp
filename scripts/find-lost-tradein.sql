-- Read-only. Everything the system still holds that mentions a word (default
-- "dragonfly"): trade-ins, exchanges, repairs, serials, stock moves, receipts,
-- audit logs and the archived activity timeline — removed / replaced rows
-- included, so a trade-in that "disappeared" from the screens can be traced.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" -v term='dragonfly' < scripts/find-lost-tradein.sql > /tmp/find-dragonfly.txt
--   less -S /tmp/find-dragonfly.txt

\set ON_ERROR_STOP off
\pset null '-'
\if :{?term}
\else
  \set term 'dragonfly'
\endif

\echo ''
\echo '1. Products named like it'
SELECT p.id, p.name, p.sku, p.is_active AS active, p.created_at::date AS created
FROM products p WHERE p.name ILIKE '%' || :'term' || '%' OR p.sku ILIKE '%' || :'term' || '%' ORDER BY p.name;

\echo ''
\echo '2. Serial numbers of those products (removed ones included)'
SELECT s.serial_number, s.status, s.location, p.name AS product, s.created_at::date AS added, s.updated_at::timestamp(0) AS last_changed,
       CASE WHEN s.removed_at IS NOT NULL THEN 'REMOVED ' || s.removed_at::date ELSE '' END AS note,
       s.screen_extras->>'saleOrderId' AS sale_ref, left(s.screen_extras->>'soldDate', 10) AS sold_date
FROM serial_numbers s LEFT JOIN products p ON p.id = s.product_id
WHERE p.name ILIKE '%' || :'term' || '%' OR s.screen_extras::text ILIKE '%' || :'term' || '%' OR coalesce(s.notes, '') ILIKE '%' || :'term' || '%'
ORDER BY s.updated_at DESC;

\echo ''
\echo '3. Screen records that mention it — trade-ins (deed_buyBacks), exchanges, repairs, sales, deliveries …'
SELECT r.key AS kind,
       coalesce(r.payload->>'ref', r.payload->>'invoiceNumber', r.payload->>'orderNumber', left(r.payload->>'id', 8)) AS record,
       r.payload->>'status' AS status,
       left(coalesce(r.payload->>'date', r.payload->>'createdAt', r.payload->>'intakeDate', r.updated_at::text), 16) AS date,
       coalesce(r.payload->>'customerName', r.payload->>'clientName', r.payload->>'vendorName', '') AS party,
       r.updated_at::timestamp(0) AS last_saved
FROM erp_state_records r
WHERE r.payload::text ILIKE '%' || :'term' || '%'
  AND r.key NOT IN ('deed_products', 'deed_auditLogs')
ORDER BY CASE WHEN r.key IN ('deed_buyBacks', 'deed_clientExchanges', 'deed_repairs_v2') THEN 0 ELSE 1 END, r.key, 4;

\echo ''
\echo '4. Trade-in / exchange details (lines with the machine)'
SELECT r.key AS kind, r.payload->>'ref' AS ref, r.payload->>'status' AS status, r.payload->>'customerName' AS customer,
       left(coalesce(r.payload->>'date', ''), 10) AS date, l->>'productName' AS product, l->>'qty' AS qty, l->>'unitPrice' AS price,
       l->'serialIds' AS serial_ids, r.payload->>'repairRef' AS from_repair
FROM erp_state_records r
CROSS JOIN LATERAL jsonb_array_elements(coalesce(
  CASE WHEN jsonb_typeof(r.payload->'lines') = 'array' THEN r.payload->'lines' END,
  CASE WHEN jsonb_typeof(r.payload->'returnLines') = 'array' THEN r.payload->'returnLines' END, '[]')) l
WHERE r.key IN ('deed_buyBacks', 'deed_clientExchanges') AND l::text ILIKE '%' || :'term' || '%';

\echo ''
\echo '5. Repairs mentioning it (a trade-in can start from a repair: retainedBuyBackRef)'
SELECT r.payload->>'ref' AS repair, r.payload->>'status' AS status, r.payload->>'customerName' AS customer,
       r.payload->>'productName' AS device, r.payload->>'serialNumber' AS serial,
       r.payload->>'retainedBuyBackRef' AS trade_in_ref, r.payload->>'retainedBuyBackId' AS trade_in_id,
       right(coalesce(r.payload->>'notes', ''), 200) AS notes_end
FROM erp_state_records r
WHERE r.key = 'deed_repairs_v2' AND r.payload::text ILIKE '%' || :'term' || '%';

\echo ''
\echo '6. Stock moves (removed ones included)'
SELECT left(coalesce(m.screen_extras->>'date', m.created_at::text), 16) AS when_, coalesce(m.screen_extras->>'type', m.movement_type::text) AS type,
       m.qty, coalesce(m.from_location, '') || ' -> ' || coalesce(m.to_location, '') AS from_to, m.document_ref, m.serial_numbers,
       left(coalesce(m.screen_extras->>'reason', m.notes, ''), 80) AS reason,
       CASE WHEN m.removed_at IS NOT NULL THEN 'REMOVED ' || m.removed_at::date ELSE '' END AS note
FROM stock_movements m
WHERE m.screen_extras::text ILIKE '%' || :'term' || '%' OR coalesce(m.notes, '') ILIKE '%' || :'term' || '%'
   OR m.product_id IN (SELECT id FROM products WHERE name ILIKE '%' || :'term' || '%')
ORDER BY 1;

\echo ''
\echo '7. Audit log (who did what)'
SELECT a.created_at::timestamp(0) AS when_, coalesce(u.username, a.user_id::text) AS who, a.action, coalesce(a.entity_key, '') AS record,
       left(coalesce(a.new_values::text, a.old_values::text, ''), 200) AS details
FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
WHERE a.new_values::text ILIKE '%' || :'term' || '%' OR a.old_values::text ILIKE '%' || :'term' || '%'
   OR coalesce(a.entity_key, '') ILIKE '%' || :'term' || '%'
ORDER BY a.created_at;

\echo ''
\echo '8. Screen activity log (audit entries kept on the screens)'
SELECT left(coalesce(r.payload->>'timestamp', r.payload->>'at', r.payload->>'createdAt', ''), 16) AS when_,
       coalesce(r.payload->>'userName', r.payload->>'user', '') AS who, r.payload->>'action' AS action,
       coalesce(r.payload->>'documentRef', r.payload->>'ref', '') AS record, left(coalesce(r.payload->>'details', ''), 200) AS details
FROM erp_state_records r
WHERE r.key = 'deed_auditLogs' AND r.payload::text ILIKE '%' || :'term' || '%'
ORDER BY 1;

\echo ''
\echo '9. Archived activity timeline (older saves, incl. deletions)'
SELECT a.at::timestamp(0) AS when_, a.actor_name AS who, left(a.payload::text, 260) AS entry
FROM store_audit_archive a
WHERE a.payload::text ILIKE '%' || :'term' || '%'
ORDER BY a.at;

\echo ''
\echo '10. Older single-copy store rows (app_state) that still mention it'
SELECT s.key, length(s.value) AS size, s.updated_at::timestamp(0) AS last_saved,
       (length(lower(s.value)) - length(replace(lower(s.value), lower(:'term'), ''))) / greatest(length(:'term'), 1) AS mentions
FROM app_state s WHERE s.value ILIKE '%' || :'term' || '%' ORDER BY s.key;

\echo ''
\echo '11. Goods receipts mentioning it'
SELECT d.ref, d.status, left(d.receipt_date, 10) AS date, CASE WHEN d.removed_at IS NOT NULL THEN 'REMOVED' ELSE '' END AS note
FROM receipt_documents d WHERE d.record::text ILIKE '%' || :'term' || '%' ORDER BY 3;
