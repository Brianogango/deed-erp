-- Odoo parity Phase 1: fiscal lock + payment allocations
-- SAFE / NON-DESTRUCTIVE:
--   * CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only
--   * ALTER COLUMN DROP NOT NULL (payments.invoice_id) — no data loss
-- Apply with: node scripts/run-safe-odoo-parity-phase1.mjs

-- ── Fiscal period lock ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_locks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_date   DATE NOT NULL,
  note        TEXT,
  updated_by  VARCHAR(80),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Payment allocations (one payment → many invoices) ────────────────────────
CREATE TABLE IF NOT EXISTS payment_allocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id    UUID NOT NULL REFERENCES invoices(id),
  amount        NUMERIC(14, 2) NOT NULL,
  allocated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice ON payment_allocations (invoice_id);

-- Allow payments without a single invoice_id (multi-invoice allocations)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'invoice_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL;
  END IF;
END $$;
