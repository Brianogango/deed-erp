-- Safe: down-payment invoice columns for Odoo-style deposits.
-- Idempotent — safe to re-run on Contabo.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS is_down_payment BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS down_payment_percent NUMERIC(5, 2) NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS down_payment_applied_to UUID NULL;

COMMENT ON COLUMN invoices.is_down_payment IS
  'True when this invoice is a Sale Order down payment / deposit (does not bump qty_invoiced).';
