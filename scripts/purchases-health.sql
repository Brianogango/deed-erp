-- Read-only. Purchase orders, goods receipts and supplier bills.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/purchases-health.sql > /tmp/purchases-health.txt
--   less -S /tmp/purchases-health.txt

\pset null '-'

\echo '1. Purchase orders by status'
SELECT po.status, count(*) AS orders, sum(po.total_amount) AS value
FROM purchase_orders po GROUP BY 1 ORDER BY 1;

\echo ''
\echo '2. Orders with the same product on more than one line (receiving and billing used to count these wrongly)'
SELECT po.po_number, po.status, c.name AS vendor, coalesce(i.description, '?') AS product, count(*) AS lines,
       string_agg(i.qty_ordered || ' ordered / ' || i.qty_received || ' received / ' || i.qty_billed || ' billed @ ' || i.unit_cost, '  |  ') AS detail
FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id LEFT JOIN clients c ON c.id = po.client_id
GROUP BY po.po_number, po.status, c.name, i.product_id, i.description HAVING count(*) > 1
ORDER BY po.po_number;

\echo ''
\echo '3. Received counters that do not match the goods receipts behind them'
SELECT po.po_number, coalesce(i.description, '?') AS product, i.qty_ordered, i.qty_received AS counter,
       coalesce((SELECT sum(g.qty_received) FROM grn_items g WHERE g.po_item_id = i.id), 0) AS on_receipts
FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id
WHERE i.qty_received <> coalesce((SELECT sum(g.qty_received) FROM grn_items g WHERE g.po_item_id = i.id), 0)
ORDER BY po.po_number;

\echo ''
\echo '4. Received but not billed after 30 days (goods in stock, no supplier bill: liability missing from the books)'
SELECT po.po_number, c.name AS vendor, coalesce(i.description, '?') AS product,
       i.qty_received - i.qty_billed AS unbilled_units, (i.qty_received - i.qty_billed) * i.unit_cost AS unbilled_value,
       (SELECT max(g.received_date) FROM goods_received_notes g WHERE g.po_id = po.id) AS last_received
FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id LEFT JOIN clients c ON c.id = po.client_id
WHERE i.qty_received > i.qty_billed
  AND coalesce((SELECT max(g.received_date) FROM goods_received_notes g WHERE g.po_id = po.id), po.order_date) < current_date - 30
ORDER BY last_received;

\echo ''
\echo '5. Billed more than received'
SELECT po.po_number, coalesce(i.description, '?') AS product, i.qty_received, i.qty_billed
FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id
WHERE i.qty_billed > i.qty_received ORDER BY po.po_number;

\echo ''
\echo '6. Confirmed orders still waiting for goods after 14 days'
SELECT po.po_number, c.name AS vendor, po.status, po.order_date, po.expected_date, po.total_amount
FROM purchase_orders po LEFT JOIN clients c ON c.id = po.client_id
WHERE po.status::text IN ('confirmed', 'sent', 'partial')
  AND coalesce(po.expected_date, po.order_date) < current_date - 14
ORDER BY coalesce(po.expected_date, po.order_date);

\echo ''
\echo '7. More than one open goods receipt for the same order (an order confirmed twice)'
SELECT r.payload->>'poRef' AS po, count(*) AS draft_receipts, string_agg(r.payload->>'ref', ', ') AS receipts
FROM erp_state_records r WHERE r.key = 'deed_receipts' AND r.payload->>'status' = 'draft'
GROUP BY 1 HAVING count(*) > 1 ORDER BY 1;

\echo ''
\echo '8. Vendor credit notes and returns sharing a number'
SELECT invoice_number, count(*) FROM invoices WHERE invoice_number LIKE 'VCN/%' GROUP BY 1 HAVING count(*) > 1;
SELECT r.payload->>'ref' AS return_ref, count(*) FROM erp_state_records r WHERE r.key = 'deed_purchaseReturns'
GROUP BY 1 HAVING count(*) > 1;
