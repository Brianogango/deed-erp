-- DeliveryNote SO-first redesign (empty-table safe).
-- Unblocks Confirm SO → Delivery → Invoice by making invoice_id nullable
-- and adding sale_order_id + blob bridge columns.
-- Safe when delivery_notes / delivery_note_items have 0 rows (verified Contabo).

BEGIN;

DROP TABLE IF EXISTS delivery_note_items CASCADE;
DROP TABLE IF EXISTS delivery_notes CASCADE;
DROP TABLE IF EXISTS "_DeliveryNoteToSaleOrder" CASCADE;
DROP TABLE IF EXISTS "_DeliveryNoteSaleOrders" CASCADE;

CREATE TABLE delivery_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_id VARCHAR(80) UNIQUE,
  dn_number VARCHAR(30) NOT NULL UNIQUE,
  sale_order_id UUID REFERENCES sale_orders(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id),
  client_id UUID REFERENCES clients(id),
  sale_order_ref VARCHAR(40),
  customer_name VARCHAR(200),
  delivery_method VARCHAR(30) NOT NULL DEFAULT 'pickup',
  status VARCHAR(30) NOT NULL DEFAULT 'waiting',
  dispatch_date DATE,
  delivery_date DATE,
  courier_name VARCHAR(100),
  tracking_number VARCHAR(80),
  delivery_address TEXT,
  recipient_name VARCHAR(150),
  recipient_phone VARCHAR(20),
  recipient_id_number VARCHAR(40),
  signature_url TEXT,
  notes TEXT,
  warranty_created BOOLEAN NOT NULL DEFAULT FALSE,
  backorder_of_id UUID,
  backorder_of_ref VARCHAR(40),
  prepared_at TIMESTAMP(3),
  prepared_by UUID REFERENCES users(id),
  delivery_note_generated_at TIMESTAMP(3),
  delivery_note_generated_by UUID REFERENCES users(id),
  dispatched_by UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_delivery_notes_sale_order ON delivery_notes(sale_order_id);
CREATE INDEX idx_delivery_notes_status ON delivery_notes(status);
CREATE INDEX idx_delivery_notes_client ON delivery_notes(client_id);

CREATE TABLE delivery_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dn_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
  invoice_item_id UUID REFERENCES invoice_items(id),
  product_id UUID REFERENCES products(id),
  serial_number_id UUID REFERENCES serial_numbers(id),
  description TEXT,
  product_name VARCHAR(200),
  qty INTEGER NOT NULL DEFAULT 0,
  qty_done INTEGER NOT NULL DEFAULT 0,
  qty_returned INTEGER NOT NULL DEFAULT 0,
  serial_ids TEXT[] NOT NULL DEFAULT '{}',
  source_location VARCHAR(40),
  line_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_delivery_note_items_dn ON delivery_note_items(dn_id);

-- Recreate FK dropped by CASCADE (OutboundRelease.deliveryNoteId)
ALTER TABLE outbound_releases
  DROP CONSTRAINT IF EXISTS outbound_releases_delivery_note_id_fkey;
ALTER TABLE outbound_releases
  ADD CONSTRAINT outbound_releases_delivery_note_id_fkey
  FOREIGN KEY (delivery_note_id) REFERENCES delivery_notes(id) ON DELETE SET NULL;

COMMIT;
