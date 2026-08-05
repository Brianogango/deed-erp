-- AGENT-DB-001 / DB-003 / DB-004 / DB-005
-- StockLevel orphan backfill + composite indexes + sale_orders status CHECK
-- SAFE / NON-DESTRUCTIVE:
--   * CREATE INDEX IF NOT EXISTS only
--   * Backfill INSERT … WHERE NOT EXISTS (idempotent)
--   * CHECK constraint added only when all existing rows are valid
-- Rollback: DROP INDEX IF EXISTS …; ALTER TABLE sale_orders DROP CONSTRAINT IF EXISTS …

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Validation (run before / after; informational) ───────────────────────────
-- SELECT COUNT(*) AS products_without_stock_level
-- FROM products p
-- WHERE NOT EXISTS (SELECT 1 FROM stock_levels sl WHERE sl.product_id = p.id);

-- ── Backfill missing StockLevel rows (deterministic id = uuidFromKey) ────────
-- Mirrors lib/accounting/ids.ts uuidFromKey('stock_level', productId):
--   md5 → UUID with version nibble 4 and variant nibble a
INSERT INTO stock_levels (id, product_id, qty_on_hand, qty_reserved, qty_on_order, updated_at)
SELECT
  (
    substr(h, 1, 8) || '-' ||
    substr(h, 9, 4) || '-' ||
    '4' || substr(h, 14, 3) || '-' ||
    'a' || substr(h, 18, 3) || '-' ||
    substr(h, 21, 12)
  )::uuid AS id,
  p.id,
  0,
  0,
  0,
  NOW()
FROM products p
CROSS JOIN LATERAL (
  SELECT md5('stock_level:' || p.id::text) AS h
) hash
WHERE NOT EXISTS (
  SELECT 1 FROM stock_levels sl WHERE sl.product_id = p.id
);

-- ── Composite indexes for common filters ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_client_status
  ON invoices (client_id, status);

CREATE INDEX IF NOT EXISTS idx_invoices_status_date
  ON invoices (status, invoice_date);

CREATE INDEX IF NOT EXISTS idx_repairs_status_created
  ON repairs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_sale_orders_client_status
  ON sale_orders (client_id, status);

-- ── CHECK: sale_orders.status (VARCHAR — Odoo-style states) ──────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sale_orders'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_sale_orders_status'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM sale_orders
      WHERE status IS NULL
         OR status NOT IN ('quotation', 'quotation_sent', 'sale', 'cancelled')
    ) THEN
      RAISE NOTICE 'Skipping chk_sale_orders_status — invalid status values present';
    ELSE
      ALTER TABLE sale_orders
        ADD CONSTRAINT chk_sale_orders_status
        CHECK (status IN ('quotation', 'quotation_sent', 'sale', 'cancelled'));
    END IF;
  END IF;
END $$;
