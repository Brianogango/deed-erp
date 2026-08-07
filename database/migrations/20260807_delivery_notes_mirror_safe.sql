-- Migration: relational dual-write support for deliveries
--
-- deed_deliveries has been the sole operational store for delivery notes —
-- delivery_notes / delivery_note_items exist in Prisma/Postgres but nothing
-- ever writes to them (P1-ARCH-001, tracked "blob_sot" in
-- docs/BLOB_PRISMA_PARITY.md). This adds the columns needed to mirror the
-- blob into these tables as a best-effort, idempotent dual-write (never
-- authoritative, never blocking, blob remains the source of truth for
-- existing UI/PDF/reports).
--
-- 1. delivery_notes.blob_id — the deed_deliveries row id this Prisma row
--    mirrors, so the mirror can upsert-by-blob-id instead of
--    deleteMany+create (stable ids across mirror passes).
-- 2. delivery_notes.sale_order_id — a direct scalar FK (the blob model is
--    one delivery per one sale order); the existing implicit M2M relation
--    stays untouched.
-- 3. delivery_note_items.qty_done — actually-shipped qty, distinct from the
--    existing `qty` (ordered/demanded) column, matching the blob's partial-
--    delivery / backorder tracking.
--
-- Purely additive; safe to re-run.

BEGIN;

ALTER TABLE delivery_notes
  ADD COLUMN IF NOT EXISTS blob_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS sale_order_id UUID REFERENCES sale_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS delivery_notes_blob_id_key ON delivery_notes (blob_id);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_sale_order ON delivery_notes (sale_order_id);

ALTER TABLE delivery_note_items
  ADD COLUMN IF NOT EXISTS qty_done INTEGER NOT NULL DEFAULT 0;

COMMIT;
