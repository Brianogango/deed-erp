-- Read-only. For finished trade-ins whose machine shows "sold": was the
-- machine sold again AFTER the trade-in? Lists every sale, delivery, invoice
-- and stock move that names the serial, with dates, so each can be judged.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/tradein-resale-check.sql

\pset null '-'

-- Finished trade-ins and their machines (same rule as tradein-sold-check.sql).
CREATE TEMP TABLE rs_tradein AS
SELECT 'buy-back'::text AS kind, b.payload->>'ref' AS ref, b.payload->>'customerName' AS customer,
       left(coalesce(b.payload->>'stockedDate', b.payload->>'date', ''), 10) AS traded_in_on, sid AS serial_id
FROM erp_state_records b
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.payload->'lines') = 'array' THEN b.payload->'lines' ELSE '[]' END) l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]' END) sid
WHERE b.key = 'deed_buyBacks' AND b.payload->>'status' = 'stocked'
UNION ALL
SELECT 'exchange', e.payload->>'ref', e.payload->>'customerName',
       left(coalesce(e.payload->>'completedDate', e.payload->>'date', ''), 10), sid
FROM erp_state_records e
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.payload->'returnLines') = 'array' THEN e.payload->'returnLines' ELSE '[]' END) l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]' END) sid
WHERE e.key = 'deed_clientExchanges' AND e.payload->>'status' = 'completed';

CREATE TEMP TABLE rs_serial AS
SELECT t.*, s.id AS sn_id, s.serial_number, s.status AS serial_status, s.location,
       s.screen_extras->>'soldDate' AS sold_date_on_serial, s.screen_extras->>'saleOrderId' AS sale_order_on_serial
FROM rs_tradein t JOIN serial_numbers s ON s.id::text = t.serial_id
WHERE s.removed_at IS NULL AND (s.status = 'sold' OR s.location = 'customer');

\echo ''
\echo '0. The machines in question'
SELECT kind, ref, customer, traded_in_on, serial_number, serial_status, location, left(sold_date_on_serial, 16) AS sold_date_on_serial, sale_order_on_serial
FROM rs_serial ORDER BY traded_in_on;

-- Every record that names the serial (by its id or its serial number).
CREATE TEMP TABLE rs_hit (serial_number text, traded_in_on text, source text, record text, happened text, status text, party text);

-- Stock moves.
INSERT INTO rs_hit
SELECT r.serial_number, r.traded_in_on, 'stock move ' || coalesce(m.screen_extras->>'type', m.movement_type::text),
       coalesce(m.document_ref, '-'), left(coalesce(m.screen_extras->>'date', m.created_at::text), 16),
       CASE WHEN m.removed_at IS NOT NULL THEN 'reversed/removed' ELSE '' END,
       coalesce(m.from_location, '') || ' -> ' || coalesce(m.to_location, '')
FROM rs_serial r JOIN stock_movements m
  ON m.serial_number_id = r.sn_id OR r.serial_number = ANY (m.serial_numbers);

-- Delivery notes (table).
INSERT INTO rs_hit
SELECT r.serial_number, r.traded_in_on, 'delivery note', d.dn_number, left(coalesce(d.updated_at, d.created_at)::text, 16), d.status, c.name
FROM rs_serial r
JOIN delivery_note_items i ON i.serial_number_id = r.sn_id OR r.sn_id::text = ANY (i.serial_ids)
JOIN delivery_notes d ON d.id = i.dn_id
LEFT JOIN clients c ON c.id = d.client_id;

-- Invoices (table).
INSERT INTO rs_hit
SELECT r.serial_number, r.traded_in_on, 'invoice ' || coalesce(inv.document_type::text, ''), inv.invoice_number, inv.invoice_date::text, inv.posting_status::text, c.name
FROM rs_serial r
JOIN invoice_items i ON i.serial_number_id = r.sn_id
JOIN invoices inv ON inv.id = i.invoice_id
LEFT JOIN clients c ON c.id = inv.client_id;

-- Sale orders (table).
INSERT INTO rs_hit
SELECT r.serial_number, r.traded_in_on, 'sale order', so.order_number, so.order_date::text, so.status::text, c.name
FROM rs_serial r
JOIN sale_order_items i ON i.serial_number_id = r.sn_id
JOIN sale_orders so ON so.id = i.sale_order_id
LEFT JOIN clients c ON c.id = so.client_id;

-- Everything on the screens (deliveries, POS sales, invoices, sale orders,
-- exchanges, transfers, repairs …) that mentions the serial id or number.
INSERT INTO rs_hit
SELECT r.serial_number, r.traded_in_on, 'screen record ' || e.key,
       coalesce(e.payload->>'ref', e.payload->>'invoiceNumber', e.payload->>'orderNumber', left(e.payload->>'id', 8)),
       left(coalesce(e.payload->>'date', e.payload->>'createdAt', e.payload->>'preparedAt', e.updated_at::text), 16),
       e.payload->>'status', coalesce(e.payload->>'customerName', e.payload->>'clientName', '')
FROM rs_serial r JOIN erp_state_records e
  ON e.payload::text LIKE '%' || r.sn_id::text || '%' OR e.payload::text LIKE '%"' || r.serial_number || '"%'
WHERE e.key NOT IN ('deed_serials', 'deed_auditLogs')
  -- the trade-in record itself
  AND NOT (e.key IN ('deed_buyBacks', 'deed_clientExchanges') AND e.payload->>'ref' = r.ref);

\echo ''
\echo '1. Everything that names each machine, oldest first ("after" = after the trade-in)'
SELECT serial_number, CASE WHEN left(happened, 10) > traded_in_on THEN 'AFTER' ELSE 'before' END AS when_, happened, source, record, status, party
FROM rs_hit ORDER BY serial_number, happened;

\echo ''
\echo '2. Verdict per machine: sold again after the trade-in?'
SELECT r.serial_number, r.ref, r.traded_in_on,
       count(h.*) FILTER (WHERE left(h.happened, 10) > r.traded_in_on
                            AND (h.source LIKE 'invoice%' OR h.source = 'delivery note' OR h.source = 'sale order'
                                 OR h.source LIKE 'stock move out%' OR h.source LIKE 'stock move sale%'
                                 OR h.source LIKE 'screen record deed_deliveries%' OR h.source LIKE 'screen record deed_pos%'
                                 OR h.source LIKE 'screen record deed_invoices%' OR h.source LIKE 'screen record deed_saleOrders%')) AS sale_records_after_trade_in,
       CASE WHEN count(h.*) FILTER (WHERE left(h.happened, 10) > r.traded_in_on
                            AND (h.source LIKE 'invoice%' OR h.source = 'delivery note' OR h.source = 'sale order'
                                 OR h.source LIKE 'stock move out%' OR h.source LIKE 'stock move sale%'
                                 OR h.source LIKE 'screen record deed_deliveries%' OR h.source LIKE 'screen record deed_pos%'
                                 OR h.source LIKE 'screen record deed_invoices%' OR h.source LIKE 'screen record deed_saleOrders%')) > 0
            THEN 'LOOKS SOLD AGAIN — check section 1' ELSE 'no later sale found' END AS verdict
FROM rs_serial r LEFT JOIN rs_hit h ON h.serial_number = r.serial_number
GROUP BY r.serial_number, r.ref, r.traded_in_on ORDER BY r.traded_in_on;

\echo ''
\echo '3. Audit log entries naming the machines'
SELECT a.created_at::timestamp(0) AS when_, a.action, coalesce(a.entity_key, '') AS record, r.serial_number,
       left(coalesce(a.new_values::text, ''), 160) AS details
FROM audit_logs a JOIN rs_serial r
  ON a.new_values::text LIKE '%' || r.serial_number || '%' OR a.old_values::text LIKE '%' || r.serial_number || '%'
  OR a.new_values::text LIKE '%' || r.sn_id::text || '%'
ORDER BY a.created_at;
