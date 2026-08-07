-- Migration: relational dual-write support for deliveries
--
-- deed_deliveries has been the sole operational store for delivery notes.
-- delivery_notes / delivery_note_items exist in Prisma/Postgres, and — as
-- discovered while wiring this migration — most of the columns needed for a
-- full mirror (blob_id, sale_order_id, sale_order_ref, customer_name,
-- recipient_id_number, warranty_created, backorder_of_id/ref, prepared_at/
-- by, delivery_note_generated_at/by, and on delivery_note_items:
-- product_name, qty_done, serial_ids, source_location, line_order) were
-- ALREADY present on the Contabo production database, created out-of-band
-- ahead of this file, apparently from a prior uncommitted attempt at this
-- same dual-write. Every statement below is guarded so it is a genuine
-- no-op on production; it exists to make the schema reproducible (and this
-- history visible in git) on any OTHER environment that doesn't have it yet
-- (fresh dev DB, CI, a second replica).
--
-- Purely additive; safe to re-run.

BEGIN;

ALTER TABLE delivery_notes
  ADD COLUMN IF NOT EXISTS blob_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS sale_order_id UUID REFERENCES sale_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_order_ref VARCHAR(40),
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS recipient_id_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS warranty_created BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backorder_of_id UUID,
  ADD COLUMN IF NOT EXISTS backorder_of_ref VARCHAR(40),
  ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS prepared_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS delivery_note_generated_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS delivery_note_generated_by UUID REFERENCES users(id);

-- client_id / created_by were declared NOT NULL in the original model, but
-- the blob never tracked either reliably enough to guarantee both on every
-- row — relax to match what a best-effort dual-write can actually supply.
ALTER TABLE delivery_notes
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN created_by DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_notes_blob_id_key ON delivery_notes (blob_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_sale_order ON delivery_notes (sale_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_status ON delivery_notes (status);

ALTER TABLE delivery_note_items
  ADD COLUMN IF NOT EXISTS product_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS qty_done INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS serial_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_location VARCHAR(40),
  ADD COLUMN IF NOT EXISTS line_order INTEGER NOT NULL DEFAULT 0;

-- product_id was declared NOT NULL originally; a delivery line for a
-- product not yet mirrored into Prisma has nothing to reference.
ALTER TABLE delivery_note_items
  ALTER COLUMN product_id DROP NOT NULL;

COMMIT;
