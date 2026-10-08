-- Additive, non-destructive: a nullable JSON column on purchase_orders and on
-- purchase_order_items, filled from the deed_purchaseOrders screen copy.
-- Apply BEFORE deploying the release that reads purchase orders from the
-- tables (Prisma selects these columns; without them those reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261008_purchase_order_screen_extras_safe.sql
--
-- The keys match PO_EXTRA_KEYS / PO_LINE_EXTRA_KEYS in lib/screen-extras.ts.

ALTER TABLE "purchase_orders"      ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;
ALTER TABLE "purchase_order_items" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;

UPDATE "purchase_orders" p SET "screen_extras" = NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'receiptIds',           r.payload->'receiptIds',
    'billId',               r.payload->'billId',
    'approvalStatus',       r.payload->'approvalStatus',
    'approvalRequestIds',   r.payload->'approvalRequestIds',
    'repairId',             r.payload->'repairId',
    'repairRef',            r.payload->'repairRef',
    'procurementRequestId', r.payload->'procurementRequestId'
  )), '{}'::jsonb)
FROM "erp_state_records" r
WHERE r.key = 'deed_purchaseOrders' AND r.payload->>'id' = p.id::text AND p."screen_extras" IS NULL;

-- Line details (serials pre-loaded from an import, specs): matched on the
-- line id, else on the product within the same order.
UPDATE "purchase_order_items" i SET "screen_extras" = x.extras
FROM (
  SELECT DISTINCT ON (i2.id) i2.id, NULLIF(jsonb_strip_nulls(jsonb_build_object(
      'importedSerials', l->'importedSerials',
      'specs',           l->'specs'
    )), '{}'::jsonb) AS extras
  FROM "purchase_order_items" i2
  JOIN "erp_state_records" r ON r.key = 'deed_purchaseOrders' AND r.payload->>'id' = i2.po_id::text
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.payload->'lines') = 'array' THEN r.payload->'lines' ELSE '[]'::jsonb END) l
  WHERE l->>'id' = i2.id::text OR l->>'productId' = i2.product_id::text
  ORDER BY i2.id, (l->>'id' = i2.id::text) DESC
) x
WHERE x.id = i.id AND x.extras IS NOT NULL AND i."screen_extras" IS NULL;

SELECT 'purchase_orders' AS tbl, count(*) AS total, count(screen_extras) AS with_extras FROM "purchase_orders"
UNION ALL
SELECT 'purchase_order_items', count(*), count(screen_extras) FROM "purchase_order_items";

-- Pre-flight: orders only the screen copy has (never reached the table).
SELECT count(*) AS only_in_screen_copy
FROM "erp_state_records" r
WHERE r.key = 'deed_purchaseOrders'
  AND NOT EXISTS (SELECT 1 FROM "purchase_orders" p WHERE p.id::text = r.payload->>'id' OR p.po_number = r.payload->>'ref');
