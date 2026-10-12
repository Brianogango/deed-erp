-- Additive, non-destructive. Each product remembers the unit cost on its
-- most recent goods receipt ("latest cost"), for pricing and replacement
-- value. The books keep using the average / FIFO cost. Apply BEFORE deploying
-- the release that reads these columns (without them products cannot load).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -P pager=off -d "$DB" < database/migrations/20261012_product_latest_cost_safe.sql

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "latest_cost" DECIMAL(14,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "latest_cost_at" TIMESTAMPTZ;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "latest_cost_ref" VARCHAR(40);

-- Filled from the most recent goods received note line with a cost.
UPDATE "products" p SET latest_cost = x.unit_cost, latest_cost_at = x.at, latest_cost_ref = x.ref
FROM (
  SELECT DISTINCT ON (gi.product_id) gi.product_id, gi.unit_cost, g.created_at AS at, left(g.grn_number, 40) AS ref
  FROM "grn_items" gi JOIN "goods_received_notes" g ON g.id = gi.grn_id
  WHERE gi.unit_cost > 0
  ORDER BY gi.product_id, g.received_date DESC, g.created_at DESC
) x
WHERE p.id = x.product_id AND p.latest_cost IS NULL;

-- Products received before goods received notes were kept: the last receipt cost event.
UPDATE "products" p SET latest_cost = x.unit_cost, latest_cost_at = x.created_at, latest_cost_ref = left(x.reference, 40)
FROM (
  SELECT DISTINCT ON (v.product_id) v.product_id, v.unit_cost, v.created_at, v.reference
  FROM "valuation_events" v
  WHERE v.kind = 'receipt' AND v.unit_cost > 0 AND v.product_id IS NOT NULL
  ORDER BY v.product_id, v.created_at DESC
) x
WHERE p.id = x.product_id AND p.latest_cost IS NULL;

SELECT count(*) FILTER (WHERE latest_cost IS NOT NULL) AS with_latest_cost,
       count(*) FILTER (WHERE latest_cost IS NOT NULL AND selling_price < latest_cost) AS selling_below_latest_cost,
       count(*) AS products
FROM "products" WHERE is_active;
