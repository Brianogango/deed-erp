-- Migration: relational bulk (location-level) stock + stock-move location/mirror columns
--
-- Location-aware bulk stock ("how much of this product is in warehouse vs
-- pending_testing vs quarantine right now") has only ever lived in the
-- deed_bulkStock JSON blob (app_state), and device reconfiguration's
-- component remove/install workflow (lib/reconfiguration/service.ts)
-- mutated ONLY that blob, with no durable relational record.
--
-- NOTE: on the Contabo production database, the bulk_stock_levels table and
-- the extra stock_movements columns below were already created out-of-band
-- (constraint/index names uq_bulk_stock_product_location /
-- idx_bulk_stock_location, and stock_movements.blob_id / document_ref /
-- serial_numbers / from_location / to_location) ahead of this file — this
-- migration documents that schema in git for the first time and makes it
-- reproducible on any OTHER environment (fresh dev DB, CI, a second
-- replica) that does not have it yet. Every statement is guarded so it is a
-- true no-op wherever the schema already matches.
--
-- 1. bulk_stock_levels — one row per (product, location), the relational
--    equivalent of a deed_bulkStock array entry.
-- 2. stock_movements gains blob_id (mirror/backfill idempotency key),
--    document_ref, serial_numbers, and from_location/to_location so a move
--    can record which bin it happened between.
-- 3. Two new stock_movement_type enum values (reconfiguration_in /
--    reconfiguration_out) so reconfiguration moves are distinguishable from
--    ordinary adjustments.
--
-- Purely additive — new table, new nullable columns, new enum values. Never
-- touches app_state; the legacy blob keeps being mirrored for existing UI
-- reads until a later, deliberate cutover. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS bulk_stock_levels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  location   VARCHAR(30) NOT NULL DEFAULT 'warehouse',
  qty        INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_bulk_stock_product_location'
  ) THEN
    ALTER TABLE bulk_stock_levels
      ADD CONSTRAINT uq_bulk_stock_product_location UNIQUE (product_id, location);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bulk_stock_location ON bulk_stock_levels (location);

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS blob_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS from_location VARCHAR(40),
  ADD COLUMN IF NOT EXISTS to_location VARCHAR(40),
  ADD COLUMN IF NOT EXISTS document_ref VARCHAR(80),
  ADD COLUMN IF NOT EXISTS serial_numbers TEXT[] NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_blob_id
  ON stock_movements (blob_id) WHERE (blob_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_stock_movements_document_ref
  ON stock_movements (document_ref);

COMMIT;

-- Enum value additions run outside the transaction above: PostgreSQL allows
-- ALTER TYPE ... ADD VALUE inside a transaction, but only as long as the new
-- value is not referenced within that same transaction — keeping it in its
-- own statement avoids relying on that nuance across PG versions.
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'reconfiguration_in';
ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'reconfiguration_out';
