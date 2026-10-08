-- Fix: copy the stock moves the table is still missing, and hand
-- consignment_devices to the app's database user.
--
-- 20261009_stock_moves_table_safe.sql added its columns but its copy step
-- stopped on a move with an unreadable quantity or date, so most moves never
-- reached stock_movements. This copies them with tolerant conversions (an
-- unreadable quantity becomes 0, an unreadable date the time it was saved).
-- consignment_devices, like the two tables fixed earlier, belonged to the
-- postgres user, so the app could not use it.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261009_stock_moves_catch_up.sql

CREATE OR REPLACE FUNCTION pg_temp.safe_ts(v text, fallback timestamptz) RETURNS timestamp AS $$
BEGIN
  RETURN (v::timestamptz) AT TIME ZONE 'UTC';
EXCEPTION WHEN others THEN
  RETURN fallback AT TIME ZONE 'UTC';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.safe_qty(v text) RETURNS int AS $$
BEGIN
  RETURN greatest(0, floor(v::numeric))::int;
EXCEPTION WHEN others THEN
  RETURN 0;
END $$ LANGUAGE plpgsql;

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
       pg_temp.safe_qty(r.payload->>'qty'), 0, pg_temp.safe_qty(r.payload->>'qty'),
       r.payload->>'reason',
       left(nullif(r.payload->>'fromLocation', ''), 40),
       left(nullif(r.payload->>'toLocation', ''), 40),
       left(nullif(r.payload->>'documentRef', ''), 80),
       CASE WHEN jsonb_typeof(r.payload->'serialNumbers') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(r.payload->'serialNumbers')) ELSE '{}'::text[] END,
       pg_temp.safe_ts(r.payload->>'date', r.created_at),
       r.payload
FROM (
  SELECT DISTINCT ON (payload->>'id') payload, created_at
  FROM "erp_state_records"
  WHERE key = 'deed_stockMoves' AND coalesce(payload->>'id', '') <> ''
  ORDER BY payload->>'id', updated_at DESC NULLS LAST
) r
LEFT JOIN "products" p ON p.id::text = r.payload->>'productId'
WHERE NOT EXISTS (SELECT 1 FROM "stock_movements" m WHERE m.blob_id = r.payload->>'id')
ON CONFLICT (blob_id) DO NOTHING;

-- Moves already in the table from before: keep them exactly as saved too.
UPDATE "stock_movements" m SET "screen_extras" = r.payload
FROM "erp_state_records" r
WHERE r.key = 'deed_stockMoves' AND r.payload->>'id' = m.blob_id AND m.screen_extras IS NULL;

DO $$
DECLARE app_owner text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices';
  IF app_owner IS NOT NULL AND EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'consignment_devices') THEN
    EXECUTE format('ALTER TABLE public.consignment_devices OWNER TO %I', app_owner);
  END IF;
END $$;

SELECT (SELECT count(*) FROM "erp_state_records" WHERE key = 'deed_stockMoves') AS moves_in_copy,
       (SELECT count(*) FROM "erp_state_records" r WHERE r.key = 'deed_stockMoves'
          AND NOT EXISTS (SELECT 1 FROM "stock_movements" m WHERE m.blob_id = r.payload->>'id')) AS still_missing;
