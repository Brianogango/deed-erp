-- Additive, non-destructive. Products: everything the screens keep for a
-- product (images, specs, units, channel prices, stock count …) is kept in
-- products.screen_extras, filled from the deed_products copy, so the screens
-- can read products from the products table. Apply BEFORE deploying the
-- release that reads them (Prisma selects the column; without it reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261009_product_screen_extras_safe.sql
--
-- Products only the table has (no screen_extras) stay off the screens, as
-- today; the list at the end is for review.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;

UPDATE "products" p SET "screen_extras" = r.payload
FROM "erp_state_records" r
WHERE r.key = 'deed_products' AND r.payload->>'id' = p.id::text;

SELECT count(*) AS products, count(screen_extras) AS shown_on_screens, count(*) FILTER (WHERE screen_extras IS NULL) AS only_in_table
FROM "products";

-- For review: products only the table has. created_at and what points at them
-- say whether each is a duplicate made by the server or a real product.
SELECT p.name, p.sku, p.is_active, p.created_at::date AS created,
       (SELECT count(*) FROM serial_numbers s WHERE s.product_id = p.id) AS serials,
       (SELECT count(*) FROM invoice_items i WHERE i.product_id = p.id) AS invoice_lines,
       (SELECT count(*) FROM purchase_order_items o WHERE o.product_id = p.id) AS po_lines,
       coalesce((SELECT qty_on_hand FROM stock_levels l WHERE l.product_id = p.id), 0) AS qty
FROM "products" p
WHERE p.screen_extras IS NULL
ORDER BY p.name;
