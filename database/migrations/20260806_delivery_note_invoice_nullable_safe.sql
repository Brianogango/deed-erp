-- Phase 0 / sales cutover blocker
-- Allow DeliveryNote rows without an invoice (Confirm SO → Delivery → Invoice).
-- SAFE / NON-DESTRUCTIVE:
--   * DROP NOT NULL only
--   * CREATE INDEX IF NOT EXISTS only
-- Rollback:
--   ALTER TABLE delivery_notes ALTER COLUMN invoice_id SET NOT NULL;  -- only if no nulls
--   DROP INDEX IF EXISTS idx_delivery_notes_invoice;
--   DROP INDEX IF EXISTS idx_delivery_notes_client;

ALTER TABLE delivery_notes
  ALTER COLUMN invoice_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice
  ON delivery_notes (invoice_id);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_client
  ON delivery_notes (client_id);
