-- Read-only. Products the screens list from the deed_products copy but that
-- have no row (same id) in the products table, so they cannot be edited once
-- the copy is frozen. For each: is there a table product with the same SKU,
-- barcode or name (a twin under another id), and is anything still using the
-- copy id or the twin's id? Changes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/copy-only-products.sql

CREATE TEMP TABLE co AS
SELECT r.payload->>'id' AS copy_id,
       r.payload->>'name' AS name,
       nullif(r.payload->>'sku', '') AS sku,
       nullif(r.payload->>'barcode', '') AS barcode,
       coalesce((r.payload->>'isActive')::boolean, true) AS active,
       coalesce(nullif(r.payload->>'stockQty', '')::numeric, 0) AS copy_stock
FROM erp_state_records r
WHERE r.key = 'deed_products'
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id::text = r.payload->>'id');

ALTER TABLE co ADD COLUMN twin_id text, ADD COLUMN twin_by text;
UPDATE co SET twin_id = p.id::text, twin_by = 'sku' FROM products p WHERE co.sku IS NOT NULL AND lower(p.sku) = lower(co.sku);
UPDATE co SET twin_id = p.id::text, twin_by = 'barcode' FROM products p WHERE co.twin_id IS NULL AND co.barcode IS NOT NULL AND p.barcode = co.barcode;
UPDATE co SET twin_id = p.id::text, twin_by = 'name' FROM products p WHERE co.twin_id IS NULL AND lower(trim(p.name)) = lower(trim(co.name));

-- Uses of an id: rows in any table with a product_id column, and rows in the
-- screen copies that mention it.
CREATE TEMP TABLE uses (id text, place text, n bigint);
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables x ON x.table_name = c.table_name AND x.table_schema = c.table_schema AND x.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'public' AND c.column_name = 'product_id' LOOP
    EXECUTE format(
      'INSERT INTO uses SELECT u.id, %L, count(*) FROM %I x JOIN (SELECT copy_id AS id FROM co UNION SELECT twin_id FROM co WHERE twin_id IS NOT NULL) u ON x.product_id::text = u.id GROUP BY u.id',
      t.table_name, t.table_name);
  END LOOP;
END $$;
INSERT INTO uses
SELECT u.id, 'copy:' || r.key, count(*)
FROM erp_state_records r
JOIN (SELECT copy_id AS id FROM co UNION SELECT twin_id FROM co WHERE twin_id IS NOT NULL) u
  ON r.payload::text LIKE '%' || u.id || '%'
WHERE r.key <> 'deed_products'
GROUP BY 1, 2;

\echo '1. Copy-only products, by whether a twin exists in the table'
SELECT coalesce(twin_by, 'no twin') AS twin, count(*) AS products,
       count(*) FILTER (WHERE active) AS active,
       count(*) FILTER (WHERE copy_stock <> 0) AS with_stock,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM uses WHERE uses.id = co.copy_id)) AS copy_id_in_use,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM uses WHERE uses.id = co.twin_id)) AS twin_id_in_use
FROM co GROUP BY 1 ORDER BY 2 DESC;

\echo '2. Where the copy ids are used'
SELECT place, count(DISTINCT u.id) AS products, sum(n) AS rows
FROM uses u JOIN co ON co.copy_id = u.id GROUP BY 1 ORDER BY 3 DESC;

\echo '3. Where the twin ids are used'
SELECT place, count(DISTINCT u.id) AS products, sum(n) AS rows
FROM uses u JOIN co ON co.twin_id = u.id GROUP BY 1 ORDER BY 3 DESC;

\echo '4. Every copy-only product'
SELECT left(name, 45) AS name, sku, active, copy_stock, coalesce(twin_by, '-') AS twin,
       (SELECT string_agg(place || ' ' || n, ', ') FROM uses WHERE uses.id = co.copy_id) AS copy_id_used_in,
       (SELECT string_agg(place || ' ' || n, ', ') FROM uses WHERE uses.id = co.twin_id) AS twin_used_in
FROM co ORDER BY twin_by NULLS FIRST, name;
