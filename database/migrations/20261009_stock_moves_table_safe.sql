-- Additive, non-destructive. Inventory stage 2: the stock-movement history
-- (deed_stockMoves) is kept whole in stock_movements, so the screens can
-- read it from the database. Apply BEFORE deploying the release that reads
-- it (Prisma selects the new column; without it reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261009_stock_moves_table_safe.sql
--
-- product_id may now be empty: a move for a product the products table does
-- not have was skipped before (only 154 of ~1,070 moves had reached it).
-- The move exactly as the screens saved it is kept in screen_extras.

ALTER TABLE "stock_movements" ALTER COLUMN "product_id" DROP NOT NULL;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;

UPDATE "stock_movements" m SET "screen_extras" = r.payload
FROM "erp_state_records" r
WHERE r.key = 'deed_stockMoves' AND r.payload->>'id' = m.blob_id AND m.screen_extras IS NULL;

INSERT INTO "stock_movements" (id, blob_id, product_id, movement_type, qty, qty_before, qty_after, notes,
  from_location, to_location, document_ref, serial_numbers, created_at, screen_extras)
SELECT gen_random_uuid(),
       left(r.payload->>'id', 80),
       p.id,
       (CASE r.payload->>'type'
          WHEN 'in' THEN 'purchase_receive'
          WHEN 'out' THEN 'sale'
          WHEN 'transfer' THEN 'transfer'
          WHEN 'return' THEN 'return_from_client'
          ELSE 'adjustment_in' END)::stock_movement_type,
       greatest(0, floor(coalesce((r.payload->>'qty')::numeric, 0)))::int, 0,
       greatest(0, floor(coalesce((r.payload->>'qty')::numeric, 0)))::int,
       r.payload->>'reason',
       left(nullif(r.payload->>'fromLocation', ''), 40),
       left(nullif(r.payload->>'toLocation', ''), 40),
       left(nullif(r.payload->>'documentRef', ''), 80),
       CASE WHEN jsonb_typeof(r.payload->'serialNumbers') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(r.payload->'serialNumbers')) ELSE '{}'::text[] END,
       CASE WHEN r.payload->>'date' ~ '^\d{4}-\d{2}-\d{2}' THEN (r.payload->>'date')::timestamptz AT TIME ZONE 'UTC' ELSE r.created_at END,
       r.payload
FROM "erp_state_records" r
LEFT JOIN "products" p ON p.id::text = r.payload->>'productId'
WHERE r.key = 'deed_stockMoves' AND coalesce(r.payload->>'id', '') <> ''
  AND NOT EXISTS (SELECT 1 FROM "stock_movements" m WHERE m.blob_id = r.payload->>'id')
ON CONFLICT (blob_id) DO NOTHING;

SELECT (SELECT count(*) FROM "erp_state_records" WHERE key = 'deed_stockMoves') AS moves_in_copy,
       (SELECT count(*) FROM "stock_movements" WHERE screen_extras IS NOT NULL) AS moves_in_table,
       (SELECT count(*) FROM "stock_movements" WHERE screen_extras IS NOT NULL AND product_id IS NULL) AS without_product_row;
