-- Additive, non-destructive. CRM lead flow: deals keep their details,
-- leads get follow-ups, quotations link to the deal they came from.
-- Apply BEFORE deploying the release that reads these columns.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -P pager=off -d "$DB" < database/migrations/20261018_crm_lead_flow_safe.sql

-- The deal fields the table had no column for (number, contact, source,
-- lost reason, won value, linked quotations …). They were dropped on every
-- save, so a reload lost them.
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "screen_extras" JSONB;

-- Lead follow-ups: what was done, when, and when to come back to it.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "next_follow_up_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_contacted_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "activity" JSONB NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS "idx_leads_next_follow_up" ON "leads" ("next_follow_up_at");
-- 20 characters cannot hold "+254 712 345 678 ext 12".
ALTER TABLE "leads" ALTER COLUMN "phone" TYPE VARCHAR(40);

-- The quotation / sale order a deal turned into.
ALTER TABLE "sale_orders" ADD COLUMN IF NOT EXISTS "opportunity_id" UUID;
CREATE INDEX IF NOT EXISTS "idx_sale_orders_opportunity" ON "sale_orders" ("opportunity_id");
