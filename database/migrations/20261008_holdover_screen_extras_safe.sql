-- Additive, non-destructive: one nullable JSON column on holdovers, and the
-- holdovers table brought in line with the deed_holdovers screen copy.
-- Apply BEFORE deploying the release that reads holdovers from the table
-- (Prisma selects this column; without it those reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261008_holdover_screen_extras_safe.sql
--
-- The old mirror read the wrong field names (customerName, issuedAt …), so
-- the client, dates and issuer never reached the table. Columns are filled
-- from the copy's real fields; everything else the screen shows goes to
-- screen_extras (keys match lib/holdover-read-model.server.ts).

ALTER TABLE "holdovers" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;

BEGIN;

CREATE TEMP TABLE screen_holdovers ON COMMIT DROP AS
SELECT DISTINCT ON (r.payload->>'id') r.payload->>'id' AS screen_id, r.payload
FROM "erp_state_records" r
WHERE r.key = 'deed_holdovers' AND coalesce(r.payload->>'id', '') <> '' AND coalesce(r.payload->>'ref', '') <> ''
ORDER BY r.payload->>'id', r.updated_at DESC NULLS LAST;

-- Pre-flight: holdovers only the screen copy has (never reached the table).
SELECT count(*) AS only_in_screen_copy
FROM screen_holdovers h
WHERE NOT EXISTS (SELECT 1 FROM "holdovers" t WHERE t.blob_id = h.screen_id OR t.ref = h.payload->>'ref');

UPDATE "holdovers" t SET
  (ref, customer_name, customer_phone, product_id, product_name, serial_id, serial_number,
   device_condition, purpose, status, issued_at, due_at, returned_at, return_condition, created_by, screen_extras)
  = (SELECT
    left(h.payload->>'ref', 40),
    left(nullif(h.payload->>'clientName', ''), 200),
    left(nullif(h.payload->>'clientPhone', ''), 40),
    left(nullif(h.payload->>'productId', ''), 80),
    left(nullif(h.payload->>'productName', ''), 200),
    left(nullif(h.payload->>'serialId', ''), 80),
    left(nullif(h.payload->>'serialNumber', ''), 120),
    left(nullif(h.payload->>'deviceCondition', ''), 40),
    left(nullif(h.payload->>'purpose', ''), 40),
    left(coalesce(nullif(h.payload->>'status', ''), 'active'), 30),
    CASE WHEN h.payload->>'issuedDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (h.payload->>'issuedDate')::timestamptz AT TIME ZONE 'UTC' END,
    CASE WHEN h.payload->>'expectedReturnDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (h.payload->>'expectedReturnDate')::timestamptz AT TIME ZONE 'UTC' END,
    CASE WHEN h.payload->>'returnedDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (h.payload->>'returnedDate')::timestamptz AT TIME ZONE 'UTC' END,
    left(nullif(h.payload->>'returnCondition', ''), 40),
    left(nullif(h.payload->>'issuedByName', ''), 80),
    NULLIF(jsonb_strip_nulls(h.payload - ARRAY['id','ref','clientName','clientPhone','productId','productName','serialId','serialNumber','deviceCondition','purpose','status','returnCondition','issuedByName']), '{}'::jsonb)),
  blob_id = h.screen_id,
  updated_at = now()
FROM screen_holdovers h
WHERE t.blob_id = h.screen_id
   OR (t.blob_id IS NULL AND t.ref = h.payload->>'ref');

INSERT INTO "holdovers" (id, blob_id, ref, customer_name, customer_phone, product_id, product_name, serial_id, serial_number,
  device_condition, purpose, status, issued_at, due_at, returned_at, return_condition, created_by, screen_extras, created_at, updated_at)
SELECT gen_random_uuid(), h.screen_id,
    left(h.payload->>'ref', 40),
    left(nullif(h.payload->>'clientName', ''), 200),
    left(nullif(h.payload->>'clientPhone', ''), 40),
    left(nullif(h.payload->>'productId', ''), 80),
    left(nullif(h.payload->>'productName', ''), 200),
    left(nullif(h.payload->>'serialId', ''), 80),
    left(nullif(h.payload->>'serialNumber', ''), 120),
    left(nullif(h.payload->>'deviceCondition', ''), 40),
    left(nullif(h.payload->>'purpose', ''), 40),
    left(coalesce(nullif(h.payload->>'status', ''), 'active'), 30),
    CASE WHEN h.payload->>'issuedDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (h.payload->>'issuedDate')::timestamptz AT TIME ZONE 'UTC' END,
    CASE WHEN h.payload->>'expectedReturnDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (h.payload->>'expectedReturnDate')::timestamptz AT TIME ZONE 'UTC' END,
    CASE WHEN h.payload->>'returnedDate' ~ '^\d{4}-\d{2}-\d{2}' THEN (h.payload->>'returnedDate')::timestamptz AT TIME ZONE 'UTC' END,
    left(nullif(h.payload->>'returnCondition', ''), 40),
    left(nullif(h.payload->>'issuedByName', ''), 80),
    NULLIF(jsonb_strip_nulls(h.payload - ARRAY['id','ref','clientName','clientPhone','productId','productName','serialId','serialNumber','deviceCondition','purpose','status','returnCondition','issuedByName']), '{}'::jsonb),
  now(), now()
FROM screen_holdovers h
WHERE NOT EXISTS (SELECT 1 FROM "holdovers" t WHERE t.blob_id = h.screen_id OR t.ref = h.payload->>'ref')
ON CONFLICT (ref) DO NOTHING;

COMMIT;

SELECT count(*) AS holdovers, count(screen_extras) AS with_extras, count(*) FILTER (WHERE status <> 'returned') AS out_now FROM "holdovers";
