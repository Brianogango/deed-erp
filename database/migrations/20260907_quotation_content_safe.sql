-- Safe: persist quotation terms and optional-product alternatives.
-- Idempotent — safe to re-run on Contabo.
-- Optional products stay off commercial totals until promoted to order lines.

BEGIN;

ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT;

ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS optional_products JSONB;

COMMENT ON COLUMN sale_orders.terms_and_conditions IS
  'Saved quotation terms and conditions. Shown on the Terms tab and appended to the customer PDF notes.';

COMMENT ON COLUMN sale_orders.optional_products IS
  'Alternative products offered on a quotation. JSON array; excluded from totals until promoted to order lines.';

COMMIT;
