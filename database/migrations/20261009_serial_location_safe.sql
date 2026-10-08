-- Additive, non-destructive. Inventory stage 1: the serials table gets the
-- location and the other details only the deed_serials screen copy held, so
-- it can become the serial record. Apply BEFORE deploying the release that
-- writes these columns (Prisma selects them; without them serial reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261009_serial_location_safe.sql

ALTER TABLE "serial_numbers" ADD COLUMN IF NOT EXISTS "location" VARCHAR(40);
ALTER TABLE "serial_numbers" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;

-- Location and every other screen field (cost, received date, sale order,
-- specs, accessories …) from the copy, matched on the serial number. Keys
-- match SERIAL_COLUMN_FIELDS in lib/blob-transfer.ts.
UPDATE "serial_numbers" s SET
  "location"      = left(nullif(r.payload->>'location', ''), 40),
  "screen_extras" = NULLIF(jsonb_strip_nulls(r.payload - ARRAY['id','serial','serialNumber','productId','productName','status','barcode','location']), '{}'::jsonb)
FROM "erp_state_records" r
WHERE r.key = 'deed_serials' AND r.payload->>'serial' = s.serial_number;

SELECT count(*) AS serials, count(location) AS with_location, count(screen_extras) AS with_details FROM "serial_numbers";

SELECT location, count(*) AS serials FROM "serial_numbers" GROUP BY 1 ORDER BY 2 DESC;

-- For review only (nothing is changed): products the copy has but the table
-- does not. They are not added automatically; some are leftovers.
SELECT r.payload->>'name' AS product, r.payload->>'sku' AS sku, r.payload->>'id' AS id,
       (SELECT count(*) FROM erp_state_records s WHERE s.key = 'deed_serials' AND s.payload->>'productId' = r.payload->>'id') AS serials,
       (SELECT coalesce(sum((b.payload->>'qty')::numeric), 0) FROM erp_state_records b WHERE b.key = 'deed_bulkStock' AND b.payload->>'productId' = r.payload->>'id') AS qty
FROM erp_state_records r
WHERE r.key = 'deed_products'
  AND NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.id::text = r.payload->>'id' OR (coalesce(r.payload->>'sku', '') <> '' AND p.sku = r.payload->>'sku')
  )
ORDER BY 1;
