-- Migration: sales workflow integrity hardening
--
-- 1. sale_orders.payment_terms_days — durable net-terms column. Previously
--    payment terms only lived on the client-store blob and were silently
--    dropped on every server sync (invoice due-date math quietly fell back
--    to a 30-day default).
-- 2. Query-pattern indexes for the exposed sale-orders list/filter surface
--    (status-only filters, salesperson-scoped reads).
-- 3. A unique constraint on (version_group_id, version_number) so concurrent
--    "New Version" requests cannot create two sibling versions with the same
--    version number. Skipped (with a NOTICE, not an error) if the existing
--    data already contains a duplicate combination — safe to re-run.

BEGIN;

ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER;

CREATE INDEX IF NOT EXISTS idx_sale_orders_status ON sale_orders (status);
CREATE INDEX IF NOT EXISTS idx_sale_orders_salesperson ON sale_orders (salesperson_id);

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT version_group_id, version_number
    FROM sale_orders
    WHERE version_group_id IS NOT NULL
    GROUP BY version_group_id, version_number
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Skipping ux_sale_orders_version: % duplicate (version_group_id, version_number) combination(s) exist. Resolve manually, then re-run this migration.', dup_count;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ux_sale_orders_version'
  ) THEN
    ALTER TABLE sale_orders
      ADD CONSTRAINT ux_sale_orders_version UNIQUE (version_group_id, version_number);
  END IF;
END $$;

COMMIT;
