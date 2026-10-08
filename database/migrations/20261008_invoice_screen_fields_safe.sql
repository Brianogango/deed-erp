-- Additive, non-destructive: four nullable columns, filled from the screen copy.
-- Apply BEFORE deploying the release that reads invoices from the table
-- (Prisma selects these columns; without them invoice reads fail).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261008_invoice_screen_fields_safe.sql
--
-- These four fields used to live only in the deed_invoices screen copy.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "delivery_job_id"  VARCHAR(64);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "salesperson_id"   VARCHAR(64);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "salesperson_name" VARCHAR(120);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "receipt_id"       VARCHAR(64);

-- Carry the values over from the screen copy (only where the column is empty).
UPDATE "invoices" i SET
  "delivery_job_id"  = COALESCE(i."delivery_job_id",  NULLIF(r.payload->>'deliveryJobId', '')),
  "salesperson_id"   = COALESCE(i."salesperson_id",   NULLIF(r.payload->>'salespersonId', '')),
  "salesperson_name" = COALESCE(i."salesperson_name", NULLIF(LEFT(r.payload->>'salespersonName', 120), '')),
  "receipt_id"       = COALESCE(i."receipt_id",       NULLIF(r.payload->>'receiptId', ''))
FROM "erp_state_records" r
WHERE r.key = 'deed_invoices' AND r.payload->>'id' = i.id::text;

SELECT count(*) FILTER (WHERE delivery_job_id IS NOT NULL) AS with_delivery_job,
       count(*) FILTER (WHERE salesperson_id IS NOT NULL)  AS with_salesperson,
       count(*) FILTER (WHERE receipt_id IS NOT NULL)      AS with_receipt
FROM "invoices";
