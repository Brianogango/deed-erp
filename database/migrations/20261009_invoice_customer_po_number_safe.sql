-- Additive, non-destructive: one nullable column. Old code ignores it.
-- Apply BEFORE deploying the release that writes invoices.customer_po_number.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customer_po_number" VARCHAR(60);
