-- Read-only. How far the inventory tables are from the screen copies, before
-- inventory moves off the copies. Changes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/inventory-table-check.sql

\echo '1. Rows in each screen copy and its table'
SELECT 'products' AS dataset,
       (SELECT count(*) FROM erp_state_records WHERE key = 'deed_products') AS in_copy,
       (SELECT count(*) FROM products) AS in_table
UNION ALL SELECT 'serials',
       (SELECT count(*) FROM erp_state_records WHERE key = 'deed_serials'),
       (SELECT count(*) FROM serial_numbers)
UNION ALL SELECT 'stock levels (product x location)',
       (SELECT count(*) FROM erp_state_records WHERE key = 'deed_bulkStock'),
       (SELECT count(*) FROM stock_levels)
UNION ALL SELECT 'stock moves',
       (SELECT count(*) FROM erp_state_records WHERE key = 'deed_stockMoves'),
       (SELECT count(*) FROM stock_movements)
UNION ALL SELECT 'goods receipts',
       (SELECT count(*) FROM erp_state_records WHERE key = 'deed_receipts'),
       (SELECT count(*) FROM goods_received_notes)
UNION ALL SELECT 'reservations',
       (SELECT count(*) FROM erp_state_records WHERE key = 'deed_stockReservations'),
       (SELECT count(*) FROM stock_reservations);

\echo '2. Products in the copy but not in the table (matched on id or SKU)'
SELECT count(*) AS products_only_in_copy,
       count(*) FILTER (WHERE coalesce((r.payload->>'isActive')::boolean, true)) AS of_which_active
FROM erp_state_records r
WHERE r.key = 'deed_products'
  AND NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.id::text = r.payload->>'id' OR (coalesce(r.payload->>'sku', '') <> '' AND p.sku = r.payload->>'sku')
  );

\echo '3. Serials in the copy but not in the table (matched on serial number), by status'
SELECT coalesce(r.payload->>'status', '?') AS copy_status, count(*) AS serials_only_in_copy
FROM erp_state_records r
WHERE r.key = 'deed_serials'
  AND NOT EXISTS (SELECT 1 FROM serial_numbers s WHERE s.serial_number = r.payload->>'serial')
GROUP BY 1 ORDER BY 2 DESC;

\echo '4. Serials in both, by copy status vs table status'
SELECT r.payload->>'status' AS copy_status, s.status AS table_status, count(*) AS serials
FROM erp_state_records r
JOIN serial_numbers s ON s.serial_number = r.payload->>'serial'
WHERE r.key = 'deed_serials'
GROUP BY 1, 2 ORDER BY 3 DESC
LIMIT 20;

\echo '5. Serial locations in the copy (the table has no location column)'
SELECT coalesce(r.payload->>'location', '?') AS location, count(*) AS serials
FROM erp_state_records r WHERE r.key = 'deed_serials'
GROUP BY 1 ORDER BY 2 DESC;

\echo '6. Quantity stock: copy total per product (all locations) vs stock_levels.qty_on_hand'
WITH copy_qty AS (
  SELECT r.payload->>'productId' AS product_id, sum(coalesce((r.payload->>'qty')::numeric, 0)) AS qty
  FROM erp_state_records r WHERE r.key = 'deed_bulkStock'
  GROUP BY 1
)
SELECT count(*) AS products_compared,
       count(*) FILTER (WHERE coalesce(l.qty_on_hand, 0) = c.qty) AS same,
       count(*) FILTER (WHERE l.id IS NULL) AS no_table_row,
       count(*) FILTER (WHERE l.id IS NOT NULL AND l.qty_on_hand <> c.qty) AS different
FROM copy_qty c
LEFT JOIN stock_levels l ON l.product_id::text = c.product_id;

\echo '7. Largest quantity differences (copy vs table)'
WITH copy_qty AS (
  SELECT r.payload->>'productId' AS product_id, sum(coalesce((r.payload->>'qty')::numeric, 0)) AS qty
  FROM erp_state_records r WHERE r.key = 'deed_bulkStock'
  GROUP BY 1
)
SELECT coalesce(p.name, c.product_id) AS product, c.qty AS copy_qty, l.qty_on_hand AS table_qty
FROM copy_qty c
LEFT JOIN stock_levels l ON l.product_id::text = c.product_id
LEFT JOIN products p ON p.id::text = c.product_id
WHERE coalesce(l.qty_on_hand, 0) <> c.qty
ORDER BY abs(c.qty - coalesce(l.qty_on_hand, 0)) DESC
LIMIT 15;
