-- Safe: Odoo 18 sales flow hardening extras.
-- Idempotent — safe to re-run on Contabo.

-- Quotation acceptance stamps (Sent ≠ Accepted).
ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ NULL;

ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS accepted_by UUID NULL;

COMMENT ON COLUMN sale_orders.accepted_at IS
  'When the customer (or staff) accepted the quotation. Distinct from sent_at.';

-- Hardware-safe default: invoice delivered quantities unless product overrides.
ALTER TABLE products
  ALTER COLUMN invoice_policy SET DEFAULT 'delivery';

-- Align existing stockable products that still carry the old 'order' default.
-- Non-stockable / service products keep Ordered Quantities.
UPDATE products
SET invoice_policy = 'delivery'
WHERE track_stock = true
  AND invoice_policy = 'order';
