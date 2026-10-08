-- Additive, non-destructive: one nullable JSON column on sale_orders and on
-- quotes, filled from the deed_saleOrders / deed_quotes screen copies.
-- Apply BEFORE deploying the release that reads sale orders and quotes from
-- the tables (Prisma selects these columns; without them those reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261008_sales_screen_extras_safe.sql
--
-- The keys match lib/screen-extras.ts.

ALTER TABLE "sale_orders" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;
ALTER TABLE "quotes"      ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;

UPDATE "sale_orders" s SET "screen_extras" = NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'approvalStatus',           r.payload->'approvalStatus',
    'approvalRequestIds',       r.payload->'approvalRequestIds',
    'approvalRequiredReason',   r.payload->'approvalRequiredReason',
    'stockReservationIds',      r.payload->'stockReservationIds',
    'creditOverrideApprovalId', r.payload->'creditOverrideApprovalId',
    'discountApprovalId',       r.payload->'discountApprovalId',
    'backorderApprovalId',      r.payload->'backorderApprovalId',
    'backorderLines',           r.payload->'backorderLines',
    'sentByName',               r.payload->'sentByName',
    'acceptedByName',           r.payload->'acceptedByName',
    'confirmedByName',          r.payload->'confirmedByName'
  )), '{}'::jsonb)
FROM "erp_state_records" r
WHERE r.key = 'deed_saleOrders' AND r.payload->>'id' = s.id::text AND s."screen_extras" IS NULL;

UPDATE "quotes" q SET "screen_extras" = NULLIF(jsonb_strip_nulls(jsonb_build_object(
    'contactPersonId',        r.payload->'contactPersonId',
    'contactPersonName',      r.payload->'contactPersonName',
    'contactPersonEmail',     r.payload->'contactPersonEmail',
    'contactPersonPhone',     r.payload->'contactPersonPhone',
    'opportunityName',        r.payload->'opportunityName',
    'ownerId',                r.payload->'ownerId',
    'ownerName',              r.payload->'ownerName',
    'source',                 r.payload->'source',
    'repairId',               r.payload->'repairId',
    'repairRef',              r.payload->'repairRef',
    'sentDate',               r.payload->'sentDate',
    'viewedDate',             r.payload->'viewedDate',
    'acceptedDate',           r.payload->'acceptedDate',
    'rejectedDate',           r.payload->'rejectedDate',
    'rejectionReason',        r.payload->'rejectionReason',
    'viewCount',              r.payload->'viewCount',
    'version',                r.payload->'version',
    'paymentTerms',           r.payload->'paymentTerms',
    'deliveryTerms',          r.payload->'deliveryTerms',
    'warranty',               r.payload->'warranty',
    'saleOrderId',            r.payload->'saleOrderId',
    'invoiceId',              r.payload->'invoiceId',
    'convertedDate',          r.payload->'convertedDate',
    'parentQuoteId',          r.payload->'parentQuoteId',
    'approvalStatus',         r.payload->'approvalStatus',
    'approvalRequestIds',     r.payload->'approvalRequestIds',
    'approvalRequiredReason', r.payload->'approvalRequiredReason'
  )), '{}'::jsonb)
FROM "erp_state_records" r
WHERE r.key = 'deed_quotes' AND r.payload->>'id' = q.id::text AND q."screen_extras" IS NULL;

SELECT 'sale_orders' AS tbl, count(*) AS total, count(screen_extras) AS with_extras FROM "sale_orders"
UNION ALL
SELECT 'quotes', count(*), count(screen_extras) FROM "quotes";

-- Pre-flight: documents only the screen copy has (never reached the table).
SELECT r.key, count(*) AS only_in_screen_copy
FROM "erp_state_records" r
WHERE (r.key = 'deed_saleOrders' AND NOT EXISTS (SELECT 1 FROM "sale_orders" s WHERE s.id::text = r.payload->>'id'))
   OR (r.key = 'deed_quotes'     AND NOT EXISTS (SELECT 1 FROM "quotes" q WHERE q.id::text = r.payload->>'id'))
GROUP BY r.key;
