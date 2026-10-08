-- Read-only. Before the screens read products from the products table: do
-- the product details there match what the screens show today (the
-- deed_products copy)? Each count is products whose value differs.
-- Changes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/product-table-check.sql

CREATE TEMP TABLE pc AS
SELECT r.payload AS c, p.*
FROM erp_state_records r
JOIN products p ON p.id::text = r.payload->>'id'
WHERE r.key = 'deed_products';

\echo '1. Products in both, and how many differ on each detail'
SELECT count(*) AS products_in_both,
  count(*) FILTER (WHERE coalesce(c->>'name', '') <> name) AS name,
  count(*) FILTER (WHERE coalesce(c->>'sku', '') <> sku) AS sku,
  count(*) FILTER (WHERE round(coalesce(nullif(c->>'salePrice', '')::numeric, 0), 2) <> selling_price) AS sale_price,
  count(*) FILTER (WHERE round(coalesce(nullif(c->>'costPrice', '')::numeric, 0), 2) <> cost_price) AS cost_price,
  count(*) FILTER (WHERE coalesce((c->>'isActive')::boolean, true) <> is_active) AS active,
  count(*) FILTER (WHERE upper(coalesce(c->>'trackingMethod', 'QUANTITY')) <> tracking_method::text) AS tracking,
  count(*) FILTER (WHERE coalesce(nullif(c->>'minStock', '')::numeric, 0) <> coalesce(reorder_level, 0)) AS min_stock,
  count(*) FILTER (WHERE coalesce(nullif(c->>'barcode', ''), '') <> coalesce(barcode, '')) AS barcode
FROM pc;

\echo '2. Sale or cost price differences (first 20)'
SELECT name, c->>'salePrice' AS screen_sale, selling_price AS table_sale,
       c->>'costPrice' AS screen_cost, cost_price AS table_cost
FROM pc
WHERE round(coalesce(nullif(c->>'salePrice', '')::numeric, 0), 2) <> selling_price
   OR round(coalesce(nullif(c->>'costPrice', '')::numeric, 0), 2) <> cost_price
ORDER BY name
LIMIT 20;

\echo '3. Name or active differences (first 20)'
SELECT c->>'name' AS screen_name, name AS table_name, c->>'isActive' AS screen_active, is_active AS table_active
FROM pc
WHERE coalesce(c->>'name', '') <> name OR coalesce((c->>'isActive')::boolean, true) <> is_active
ORDER BY 2
LIMIT 20;

\echo '4. Products only in the table (not shown on the screens)'
SELECT count(*) AS only_in_table, count(*) FILTER (WHERE is_active) AS of_which_active
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM erp_state_records r WHERE r.key = 'deed_products' AND r.payload->>'id' = p.id::text);
