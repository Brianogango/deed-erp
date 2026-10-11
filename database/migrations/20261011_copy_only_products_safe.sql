-- Products the deed_products copy lists under an id the products table lacks.
-- Apply after the release that hides stale duplicates (stock-read-model).
-- Nothing is deleted.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261011_copy_only_products_safe.sql
--
-- 1. A table product with the same SKU, barcode or name (its twin) is the
--    real product: serials, invoices and stock use its id. It gets the copy
--    row's screen details (images, specs, unit …) when it has none yet; the
--    stale copy row stays in the copy but is no longer listed.
-- 2. No twin: the product is added to the table under its own id, with the
--    copy's name, SKU, prices, active flag and tracking (a name longer than
--    500 characters is cut to fit; the full one stays in screen_extras).

BEGIN;

CREATE TEMP TABLE co AS
SELECT r.payload AS payload,
       r.payload->>'id' AS copy_id,
       nullif(trim(r.payload->>'name'), '') AS name,
       nullif(trim(r.payload->>'sku'), '') AS sku,
       nullif(trim(r.payload->>'barcode'), '') AS barcode,
       NULL::uuid AS twin_id
FROM erp_state_records r
WHERE r.key = 'deed_products'
  AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id::text = r.payload->>'id');

UPDATE co SET twin_id = p.id FROM products p WHERE co.sku IS NOT NULL AND lower(p.sku) = lower(co.sku);
UPDATE co SET twin_id = p.id FROM products p WHERE co.twin_id IS NULL AND co.barcode IS NOT NULL AND lower(p.barcode) = lower(co.barcode);
UPDATE co SET twin_id = p.id FROM products p
WHERE co.twin_id IS NULL AND co.name IS NOT NULL
  AND lower(regexp_replace(trim(p.name), '\s+', ' ', 'g')) = lower(regexp_replace(co.name, '\s+', ' ', 'g'));

-- 1. Twins take the screen details (one copy row per twin).
UPDATE products p
SET screen_extras = jsonb_set(x.payload, '{id}', to_jsonb(p.id::text)), updated_at = now()
FROM (SELECT DISTINCT ON (twin_id) twin_id, payload FROM co WHERE twin_id IS NOT NULL ORDER BY twin_id, copy_id) x
WHERE p.id = x.twin_id AND p.screen_extras IS NULL;

-- 2. No twin: add it under its own id.
INSERT INTO products (id, sku, barcode, name, selling_price, cost_price, is_active, tracking_method, track_stock, reorder_level, screen_extras, updated_at)
SELECT co.copy_id::uuid,
       left(coalesce(co.sku, 'P-' || upper(left(replace(co.copy_id, '-', ''), 10))), 60),
       CASE WHEN length(co.barcode) <= 60 AND NOT EXISTS (SELECT 1 FROM products b WHERE lower(b.barcode) = lower(co.barcode)) THEN co.barcode END,
       left(coalesce(co.name, 'Unnamed product'), 500),
       round(coalesce(nullif(co.payload->>'salePrice', '')::numeric, 0), 2),
       round(coalesce(nullif(co.payload->>'costPrice', '')::numeric, 0), 2),
       coalesce((co.payload->>'isActive')::boolean, true),
       CASE WHEN upper(co.payload->>'trackingMethod') = 'SERIAL' THEN 'SERIAL' ELSE 'QUANTITY' END::tracking_method,
       coalesce(co.payload->>'productKind', '') <> 'service',
       coalesce(nullif(co.payload->>'minStock', '')::numeric, 0)::int,
       co.payload,
       now()
FROM co
WHERE co.twin_id IS NULL
  AND co.copy_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (SELECT 1 FROM products s WHERE lower(s.sku) = lower(left(coalesce(co.sku, 'P-' || upper(left(replace(co.copy_id, '-', ''), 10))), 60)))
ON CONFLICT DO NOTHING;

\echo 'Copy-only products: given to a twin / added / left as they were'
SELECT count(*) FILTER (WHERE twin_id IS NOT NULL) AS twin,
       count(*) FILTER (WHERE twin_id IS NULL AND EXISTS (SELECT 1 FROM products p WHERE p.id::text = co.copy_id)) AS added,
       count(*) FILTER (WHERE twin_id IS NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id::text = co.copy_id)) AS left_as_is
FROM co;

\echo 'Left as they were (id not a uuid, or SKU taken)'
SELECT left(name, 50) AS name, sku, copy_id FROM co
WHERE twin_id IS NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id::text = co.copy_id);

\echo 'Stock still filed under a stale copy id (move by hand if any)'
SELECT co.name, l.location, l.qty, p.name AS twin
FROM co JOIN stock_location_levels l ON l.product_id::text = co.copy_id
LEFT JOIN products p ON p.id = co.twin_id
WHERE co.twin_id IS NOT NULL;

COMMIT;
