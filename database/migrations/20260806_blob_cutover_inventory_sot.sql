-- Blob → Postgres cutover: serials, stock moves, PO/GRN, bulk stock
-- Additive only. Safe to re-run. Never drops blob app_state keys.

BEGIN;

-- ── serial_numbers: location + blob bridge ──────────────────────────────────
ALTER TABLE serial_numbers
  ADD COLUMN IF NOT EXISTS blob_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS location VARCHAR(30) DEFAULT 'warehouse',
  ADD COLUMN IF NOT EXISTS received_date DATE,
  ADD COLUMN IF NOT EXISTS sold_date DATE,
  ADD COLUMN IF NOT EXISTS product_name VARCHAR(200);

CREATE UNIQUE INDEX IF NOT EXISTS uq_serial_numbers_blob_id
  ON serial_numbers (blob_id) WHERE blob_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_serials_location ON serial_numbers (location);
CREATE INDEX IF NOT EXISTS idx_serials_status_location ON serial_numbers (status, location);

-- ── stock_movements: blob bridge + locations + document ref ─────────────────
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS blob_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS from_location VARCHAR(40),
  ADD COLUMN IF NOT EXISTS to_location VARCHAR(40),
  ADD COLUMN IF NOT EXISTS document_ref VARCHAR(80),
  ADD COLUMN IF NOT EXISTS serial_numbers TEXT[] DEFAULT '{}';

ALTER TABLE stock_movements
  ALTER COLUMN qty_before SET DEFAULT 0,
  ALTER COLUMN qty_after SET DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_blob_id
  ON stock_movements (blob_id) WHERE blob_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_document_ref
  ON stock_movements (document_ref);

-- ── purchase_orders: blob bridge ────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS blob_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS vendor_name VARCHAR(200);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_blob_id
  ON purchase_orders (blob_id) WHERE blob_id IS NOT NULL;

-- ── goods_received_notes: blob bridge + destination + status ────────────────
ALTER TABLE goods_received_notes
  ADD COLUMN IF NOT EXISTS blob_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS destination_location VARCHAR(40) DEFAULT 'warehouse',
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS vendor_name VARCHAR(200);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goods_received_notes_blob_id
  ON goods_received_notes (blob_id) WHERE blob_id IS NOT NULL;

-- GRN lines: allow orphan-safe qty_expected; po_item still required but we always
-- ensure PO items exist before insert. Add qty_expected for blob parity.
ALTER TABLE grn_items
  ADD COLUMN IF NOT EXISTS qty_expected INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_name VARCHAR(200);

-- ── bulk_stock_levels (location-aware qty; mirrors deed_bulkStock) ──────────
CREATE TABLE IF NOT EXISTS bulk_stock_levels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location    VARCHAR(30) NOT NULL DEFAULT 'warehouse',
  qty         INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bulk_stock_product_location UNIQUE (product_id, location)
);

CREATE INDEX IF NOT EXISTS idx_bulk_stock_location ON bulk_stock_levels (location);

COMMIT;
