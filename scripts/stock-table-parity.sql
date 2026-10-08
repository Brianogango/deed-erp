-- Read-only. Same check as /api/inventory/table-parity, from the terminal:
-- do the stock tables hold what the screen copies hold? Changes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/stock-table-parity.sql

\echo '0. Migrations applied (each should say t)'
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'serial_numbers' AND column_name = 'location') AS serial_location,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'serial_numbers' AND column_name = 'removed_at') AS stock_locations,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_movements' AND column_name = 'screen_extras') AS stock_moves,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipt_documents') AS receipt_documents;

\echo '1. Serials: in the copy, missing from the table (should be 0)'
SELECT count(*) AS serials_missing_from_table
FROM erp_state_records r
WHERE r.key = 'deed_serials'
  AND NOT EXISTS (SELECT 1 FROM serial_numbers s WHERE s.serial_number = r.payload->>'serial' AND s.removed_at IS NULL);

\echo '2. Serials: location or status different (should be 0)'
SELECT count(*) AS serials_differing
FROM erp_state_records r
JOIN serial_numbers s ON s.serial_number = r.payload->>'serial'
WHERE r.key = 'deed_serials'
  AND (coalesce(s.location, '') <> coalesce(r.payload->>'location', '')
    OR coalesce(s.screen_extras->>'status', '') <> coalesce(r.payload->>'status', ''));

\echo '3. Quantity stock per product and location: different (should be 0)'
WITH copy AS (
  SELECT r.payload->>'productId' AS product_id, coalesce(nullif(r.payload->>'location', ''), 'warehouse') AS location,
         sum(round(coalesce((r.payload->>'qty')::numeric, 0)))::int AS qty
  FROM erp_state_records r WHERE r.key = 'deed_bulkStock' GROUP BY 1, 2
)
SELECT count(*) AS stock_rows_differing
FROM copy c
FULL JOIN stock_location_levels t ON t.product_id = c.product_id AND t.location = c.location
WHERE coalesce(c.qty, 0) <> coalesce(t.qty, 0);

\echo '4. Stock moves and receipts: in the copy, missing from the table (should be 0)'
SELECT
  (SELECT count(*) FROM erp_state_records r WHERE r.key = 'deed_stockMoves'
     AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.blob_id = r.payload->>'id')) AS moves_missing,
  (SELECT count(*) FROM erp_state_records r WHERE r.key = 'deed_receipts'
     AND NOT EXISTS (SELECT 1 FROM receipt_documents d WHERE d.id = r.payload->>'id' AND d.removed_at IS NULL)) AS receipts_missing;
