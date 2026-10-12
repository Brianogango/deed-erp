-- Read-only. Everything recorded about one product, and who did what.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" -v name='EliteBook 845 G7 Rubber' < scripts/product-history.sql > /tmp/product-history.txt
--   less -S /tmp/product-history.txt
--
-- `name` is matched anywhere in the product name, SKU or barcode, ignoring
-- case. Every product it matches is included (section 0 lists them).

\set ON_ERROR_STOP off
\pset null '-'

CREATE TEMP TABLE hist_product AS
SELECT p.id::text AS id, p.name, p.sku
FROM products p
WHERE p.name ILIKE '%' || :'name' || '%' OR p.sku ILIKE '%' || :'name' || '%' OR coalesce(p.barcode, '') ILIKE '%' || :'name' || '%';

-- Products only the screen copy has (not in the products table).
INSERT INTO hist_product
SELECT DISTINCT r.payload->>'id', r.payload->>'name', r.payload->>'sku'
FROM erp_state_records r
WHERE r.key = 'deed_products' AND (r.payload->>'name' ILIKE '%' || :'name' || '%' OR r.payload->>'sku' ILIKE '%' || :'name' || '%')
  AND NOT EXISTS (SELECT 1 FROM hist_product h WHERE h.id = r.payload->>'id');

-- user id -> name, for the "who" columns.
CREATE TEMP TABLE hist_user AS
SELECT u.id::text AS id, coalesce(nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''), u.username) AS who
FROM users u LEFT JOIN employees e ON e.id = u.employee_id;

-- Every "who" field on a saved record (createdByName, approvedBy, userId …), user ids turned into names.
CREATE OR REPLACE FUNCTION pg_temp.who(p jsonb) RETURNS text AS $$
  SELECT string_agg(k || '=' || coalesce((SELECT u.who FROM hist_user u WHERE u.id = v), v), ', ' ORDER BY k)
  FROM (SELECT key AS k, value #>> '{}' AS v FROM jsonb_each(p)
        WHERE jsonb_typeof(value) = 'string' AND value #>> '{}' <> ''
          AND (key ~* '(by|byname|byuserid|username|userid|cashier|requestedby|approvedby|preparedby|issuedby|receivedby|validatedby|createdby|updatedby|technician|salesperson)$'
               OR key ~* '^(user|cashier|salesperson|technician)')) f
$$ LANGUAGE sql;

-- Any date the record carries, earliest first.
CREATE OR REPLACE FUNCTION pg_temp.day(p jsonb) RETURNS text AS $$
  SELECT left(coalesce(p->>'date', p->>'createdAt', p->>'requestedAt', p->>'receivedDate', p->>'receiptDate',
                       p->>'preparedAt', p->>'orderDate', p->>'reservedDate', p->>'changedAt', p->>'updatedAt'), 16)
$$ LANGUAGE sql;

\echo ''
\echo '0. Products matched'
SELECT h.id, h.name, h.sku, p.is_active AS active, p.created_at::date AS created, p.updated_at::date AS last_changed
FROM hist_product h LEFT JOIN products p ON p.id::text = h.id ORDER BY h.name;

\echo ''
\echo '1. Stock on hand now, by location'
SELECT l.location, l.qty, l.updated_at::date AS last_changed
FROM stock_location_levels l WHERE l.product_id IN (SELECT id FROM hist_product) ORDER BY l.location;

\echo ''
\echo '2. Stock movements (every in / out / transfer / adjustment), oldest first'
SELECT left(coalesce(m.screen_extras->>'date', m.created_at::text), 16) AS when_,
       coalesce(m.screen_extras->>'type', m.movement_type::text) AS type, m.qty,
       coalesce(m.from_location, '') || ' -> ' || coalesce(m.to_location, '') AS from_to,
       m.document_ref AS document, coalesce(m.screen_extras->>'reason', m.notes) AS reason,
       coalesce((SELECT u.who FROM hist_user u WHERE u.id = m.screen_extras->>'userId'), m.screen_extras->>'userId',
                (SELECT u.who FROM hist_user u WHERE u.id = m.created_by::text)) AS who,
       CASE WHEN m.removed_at IS NOT NULL THEN 'reversed/removed ' || m.removed_at::date ELSE '' END AS note
FROM stock_movements m
WHERE m.product_id::text IN (SELECT id FROM hist_product) OR m.screen_extras->>'productId' IN (SELECT id FROM hist_product)
ORDER BY 1;

\echo ''
\echo '3. Audit log (who changed what, from the server log)'
SELECT a.created_at::timestamp(0) AS when_, coalesce(u.who, a.user_id::text) AS who, a.action, a.entity_type,
       coalesce(a.entity_key, left(a.entity_id::text, 8)) AS record,
       left(coalesce(a.new_values::text, ''), 220) AS details
FROM audit_logs a LEFT JOIN hist_user u ON u.id = a.user_id::text
WHERE a.entity_id::text IN (SELECT id FROM hist_product)
   OR EXISTS (SELECT 1 FROM hist_product h WHERE a.old_values::text LIKE '%' || h.id || '%' OR a.new_values::text LIKE '%' || h.id || '%')
ORDER BY a.created_at;

\echo ''
\echo '4. Screen records that mention the product (adjustments, transfers, receipts, deliveries, till sales, price changes, write-offs …)'
SELECT r.key AS kind,
       coalesce(r.payload->>'ref', r.payload->>'reference', r.payload->>'invoiceNumber', r.payload->>'orderNumber', left(r.payload->>'id', 8)) AS record,
       pg_temp.day(r.payload) AS when_,
       r.payload->>'status' AS status,
       pg_temp.who(r.payload) AS who,
       left(coalesce(r.payload->>'reason', r.payload->>'notes', r.payload->>'customerName', r.payload->>'vendorName', ''), 80) AS details
FROM erp_state_records r
-- Lists with their own table are shown from that table below (their old copies stop at the freeze).
WHERE r.key NOT IN ('deed_products', 'deed_stockMoves', 'deed_serials', 'deed_bulkStock', 'deed_invoices', 'deed_saleOrders',
                    'deed_quotes', 'deed_purchaseOrders', 'deed_receipts', 'deed_stockReservations', 'deed_journalEntries', 'deed_auditLogs')
  AND EXISTS (SELECT 1 FROM hist_product h WHERE r.payload::text LIKE '%' || h.id || '%')
ORDER BY r.key, 3;

\echo ''
\echo '5. Goods receipts (from the receipts table)'
SELECT d.ref, d.status, left(d.receipt_date, 10) AS date, pg_temp.who(d.record) AS who,
       (SELECT sum(coalesce((l->>'qtyReceived')::numeric, (l->>'qty')::numeric, 0)) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.record->'lines') = 'array' THEN d.record->'lines' ELSE '[]' END) l
         WHERE l->>'productId' IN (SELECT id FROM hist_product)) AS qty,
       CASE WHEN d.removed_at IS NOT NULL THEN 'removed' ELSE '' END AS note
FROM receipt_documents d
WHERE EXISTS (SELECT 1 FROM hist_product h WHERE d.record::text LIKE '%' || h.id || '%')
ORDER BY 3;

\echo ''
\echo '6. Purchase orders'
SELECT po.po_number, po.status, po.order_date::date AS date, v.name AS supplier, i.qty_ordered, i.qty_received, i.qty_billed, i.unit_cost,
       (SELECT u.who FROM hist_user u WHERE u.id = po.created_by::text) AS created_by,
       (SELECT u.who FROM hist_user u WHERE u.id = po.approved_by::text) AS approved_by
FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id LEFT JOIN clients v ON v.id = coalesce(po.client_id, po.supplier_id)
WHERE i.product_id::text IN (SELECT id FROM hist_product)
ORDER BY 3;

\echo ''
\echo '7. Sale orders / quotations'
SELECT so.order_number, so.status, so.order_date::date AS date, c.name AS customer, i.qty, i.qty_delivered, i.qty_invoiced, i."unitPrice" AS unit_price,
       (SELECT u.who FROM hist_user u WHERE u.id = so.created_by::text) AS created_by, so.salesperson_name
FROM sale_order_items i JOIN sale_orders so ON so.id = i.sale_order_id LEFT JOIN clients c ON c.id = so.client_id
WHERE i.product_id::text IN (SELECT id FROM hist_product)
ORDER BY 3;

\echo ''
\echo '8. Invoices, bills and credit notes'
SELECT inv.invoice_number, inv.document_type, inv.posting_status, inv.invoice_date::date AS date, c.name AS party, i.qty, i.unit_price, i.line_total,
       (SELECT u.who FROM hist_user u WHERE u.id = inv.created_by::text) AS created_by
FROM invoice_items i JOIN invoices inv ON inv.id = i.invoice_id LEFT JOIN clients c ON c.id = inv.client_id
WHERE i.product_id::text IN (SELECT id FROM hist_product)
ORDER BY 4;

\echo ''
\echo '9. Reservations'
SELECT coalesce(r.reference_ref, r.sale_order_ref) AS for_, r.reserved_for, r.qty, r.status, r.reserved_at::date AS reserved, r.released_at::date AS released,
       pg_temp.who(coalesce(r.screen_extras, '{}')) AS who,
       CASE WHEN r.removed_at IS NOT NULL THEN 'removed' ELSE '' END AS note
FROM stock_reservations r
WHERE r.product_id::text IN (SELECT id FROM hist_product) OR r.screen_extras->>'productId' IN (SELECT id FROM hist_product)
ORDER BY r.reserved_at;

\echo ''
\echo '10. Valuation (cost) events'
SELECT v.created_at::date AS date, v.kind, v.qty, v.unit_cost, v.reference
FROM valuation_events v WHERE v.product_id::text IN (SELECT id FROM hist_product) ORDER BY v.created_at;

\echo ''
\echo '11. Serial numbers (if tracked by serial)'
SELECT s.serial_number, s.status, s.location, s.created_at::date AS added, s.updated_at::date AS last_changed,
       CASE WHEN s.removed_at IS NOT NULL THEN 'removed' ELSE '' END AS note
FROM serial_numbers s WHERE s.product_id::text IN (SELECT id FROM hist_product) ORDER BY s.created_at;
