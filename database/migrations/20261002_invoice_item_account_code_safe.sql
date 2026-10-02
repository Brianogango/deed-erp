-- Additive, non-destructive: one nullable column. Old code ignores it.
-- Apply BEFORE deploying the release that writes invoice_items.account_code.
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "account_code" VARCHAR(20);
