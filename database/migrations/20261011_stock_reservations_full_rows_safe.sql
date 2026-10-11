-- Additive, non-destructive. Reservations stage 1: every reservation is kept
-- whole in stock_reservations (screen_extras), so the screens can later read
-- them from the database. Apply BEFORE deploying the release that writes
-- these columns (Prisma selects them; without them reservation saves fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -P pager=off -d "$DB" < database/migrations/20261011_stock_reservations_full_rows_safe.sql
--
-- The old mirror kept only some fields (product name, who reserved it, the
-- delivery link and all but the first serial were lost) and skipped saves
-- that arrived while it was busy. Nothing is deleted: a table row whose
-- reservation is no longer in the screens' list is marked removed.

ALTER TABLE "stock_reservations" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;
ALTER TABLE "stock_reservations" ADD COLUMN IF NOT EXISTS "removed_at" TIMESTAMPTZ;
ALTER TABLE "stock_reservations" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now();

BEGIN;

CREATE TEMP TABLE screen_reservations ON COMMIT DROP AS
SELECT DISTINCT ON (r.payload->>'id') left(r.payload->>'id', 120) AS screen_id, r.payload
FROM "erp_state_records" r
WHERE r.key = 'deed_stockReservations' AND coalesce(r.payload->>'id', '') <> ''
ORDER BY r.payload->>'id', r.updated_at DESC NULLS LAST;

\echo 'Before'
SELECT (SELECT count(*) FROM screen_reservations) AS in_copy,
       (SELECT count(*) FROM "stock_reservations") AS in_table,
       (SELECT count(*) FROM screen_reservations s
         WHERE NOT EXISTS (SELECT 1 FROM "stock_reservations" t WHERE t.blob_id = s.screen_id)) AS only_in_copy;

-- Rows already in the table: keep the whole reservation and refresh the main fields.
UPDATE "stock_reservations" t SET
  screen_extras = s.payload,
  qty = greatest(1, floor(coalesce(nullif(s.payload->>'qty', '')::numeric, 1)))::int,
  location = left(coalesce(nullif(s.payload->>'location', ''), 'warehouse'), 30),
  reserved_for = left(nullif(s.payload->>'reservedFor', ''), 40),
  reference_id = left(nullif(s.payload->>'referenceId', ''), 80),
  reference_ref = left(nullif(s.payload->>'referenceRef', ''), 80),
  removed_at = NULL,
  updated_at = now()
FROM screen_reservations s
WHERE t.blob_id = s.screen_id;

-- Reservations only the copy has. A second active reservation on one serial
-- is kept without the serial link (the table allows one active per serial).
INSERT INTO "stock_reservations" (id, blob_id, sale_order_id, sale_order_ref, product_id, serial_id, qty, location,
  reserved_for, reference_id, reference_ref, status, reserved_at, released_at, created_at, updated_at, screen_extras)
SELECT gen_random_uuid(), s.screen_id,
  CASE WHEN s.payload->>'reservedFor' IN ('sale_order', 'sales_order')
        AND s.payload->>'referenceId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN (s.payload->>'referenceId')::uuid END,
  left(nullif(s.payload->>'referenceRef', ''), 40),
  p.id,
  CASE WHEN NOT EXISTS (SELECT 1 FROM "stock_reservations" x WHERE x.serial_id = sn.id AND x.status = 'reserved')
            AND coalesce(s.payload->>'status', 'reserved') = 'reserved'
       THEN sn.id
       WHEN coalesce(s.payload->>'status', 'reserved') <> 'reserved' THEN sn.id END,
  greatest(1, floor(coalesce(nullif(s.payload->>'qty', '')::numeric, 1)))::int,
  left(coalesce(nullif(s.payload->>'location', ''), 'warehouse'), 30),
  left(nullif(s.payload->>'reservedFor', ''), 40),
  left(nullif(s.payload->>'referenceId', ''), 80),
  left(nullif(s.payload->>'referenceRef', ''), 80),
  left(coalesce(nullif(s.payload->>'status', ''), 'reserved'), 20),
  CASE WHEN s.payload->>'reservedDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (s.payload->>'reservedDate')::timestamptz ELSE now() END,
  CASE WHEN s.payload->>'releasedDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (s.payload->>'releasedDate')::timestamptz
       WHEN s.payload->>'fulfilledDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (s.payload->>'fulfilledDate')::timestamptz END,
  now(), now(), s.payload
FROM screen_reservations s
LEFT JOIN "products" p ON p.id::text = s.payload->>'productId'
LEFT JOIN "serial_numbers" sn ON sn.id::text = coalesce(s.payload->'serialNumbers'->>0, s.payload->'serialIds'->>0, s.payload->>'serialId')
WHERE NOT EXISTS (SELECT 1 FROM "stock_reservations" t WHERE t.blob_id = s.screen_id)
ON CONFLICT DO NOTHING;

-- Table rows the screens' list no longer has (only when the copy is there at all).
UPDATE "stock_reservations" t SET removed_at = now()
WHERE t.removed_at IS NULL AND t.blob_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM screen_reservations)
  AND NOT EXISTS (SELECT 1 FROM screen_reservations s WHERE s.screen_id = t.blob_id);

COMMIT;

\echo 'After (in_copy and kept_whole should match)'
SELECT (SELECT count(*) FROM "erp_state_records" WHERE key = 'deed_stockReservations') AS in_copy,
       count(*) FILTER (WHERE screen_extras IS NOT NULL AND removed_at IS NULL) AS kept_whole,
       count(*) FILTER (WHERE removed_at IS NOT NULL) AS marked_removed,
       count(*) FILTER (WHERE status = 'reserved' AND removed_at IS NULL) AS active
FROM "stock_reservations";
