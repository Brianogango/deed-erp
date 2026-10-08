-- Additive, non-destructive. Inventory stage 2: quantity stock per location
-- gets its own table, and the serials table keeps every serial field the
-- screens use (id, exact status, product name), so the screens can read
-- serials and stock from the database. Apply BEFORE deploying the release
-- that reads them (Prisma selects these columns; without them reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261009_stock_locations_safe.sql

-- 1. Quantity stock per product and location (the deed_bulkStock copy).
CREATE TABLE IF NOT EXISTS "stock_location_levels" (
  "product_id" VARCHAR(80) NOT NULL,
  "location"   VARCHAR(40) NOT NULL,
  "qty"        INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("product_id", "location")
);

INSERT INTO "stock_location_levels" (product_id, location, qty, updated_at)
SELECT r.payload->>'productId', coalesce(nullif(r.payload->>'location', ''), 'warehouse'),
       sum(round(coalesce((r.payload->>'qty')::numeric, 0)))::int, now()
FROM "erp_state_records" r
WHERE r.key = 'deed_bulkStock' AND coalesce(r.payload->>'productId', '') <> ''
GROUP BY 1, 2
ON CONFLICT (product_id, location) DO UPDATE SET qty = EXCLUDED.qty, updated_at = now();

-- 2. Serials: keep the screen id, exact status and product name too, and
--    mark serials removed from the list instead of deleting their row
--    (invoices, deliveries and repairs point at it).
ALTER TABLE "serial_numbers" ADD COLUMN IF NOT EXISTS "removed_at" TIMESTAMP(3);

UPDATE "serial_numbers" s SET
  "screen_extras" = NULLIF(jsonb_strip_nulls(r.payload - ARRAY['serial','serialNumber','productId','barcode','location']), '{}'::jsonb),
  "location"      = left(nullif(r.payload->>'location', ''), 40)
FROM "erp_state_records" r
WHERE r.key = 'deed_serials' AND r.payload->>'serial' = s.serial_number;

UPDATE "serial_numbers" s SET "removed_at" = now()
WHERE s.removed_at IS NULL
  AND EXISTS (SELECT 1 FROM "erp_state_records" WHERE key = 'deed_serials')
  AND NOT EXISTS (SELECT 1 FROM "erp_state_records" r WHERE r.key = 'deed_serials' AND r.payload->>'serial' = s.serial_number);

SELECT 'stock_location_levels' AS tbl, count(*) AS rows, sum(qty) AS units FROM "stock_location_levels"
UNION ALL
SELECT 'deed_bulkStock copy', count(*), sum(round(coalesce((payload->>'qty')::numeric, 0)))::bigint FROM "erp_state_records" WHERE key = 'deed_bulkStock'
UNION ALL
SELECT 'serials listed', count(*) FILTER (WHERE removed_at IS NULL), count(*) FILTER (WHERE removed_at IS NOT NULL) FROM "serial_numbers";

-- The table must belong to the app user (see 20261009_new_table_owner_fix.sql).
DO $$ DECLARE o text; BEGIN SELECT tableowner INTO o FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices'; IF o IS NOT NULL THEN EXECUTE format('ALTER TABLE public.%I OWNER TO %I', 'stock_location_levels', o); END IF; END $$;
