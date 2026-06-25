-- Safe, additive-only inventory foundation migration.
-- This migration is intentionally non-destructive and can be re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tracking_method') THEN
    CREATE TYPE tracking_method AS ENUM ('NONE', 'QUANTITY', 'BATCH', 'SERIAL');
  END IF;
END
$$;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tracking_method tracking_method;

UPDATE products
SET tracking_method = CASE
  WHEN track_stock IS FALSE THEN 'NONE'::tracking_method
  ELSE COALESCE(tracking_method, 'QUANTITY'::tracking_method)
END
WHERE tracking_method IS NULL;

ALTER TABLE products
  ALTER COLUMN tracking_method SET DEFAULT 'QUANTITY'::tracking_method;

ALTER TABLE serial_numbers
  ADD COLUMN IF NOT EXISTS inventory_barcode VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS idx_serial_numbers_inventory_barcode_unique
  ON serial_numbers (inventory_barcode)
  WHERE inventory_barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number VARCHAR(100) NOT NULL,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id VARCHAR(80) NOT NULL,
  location_id VARCHAR(80),
  quantity_received INTEGER NOT NULL DEFAULT 0,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2),
  expiry_date DATE,
  supplier_id UUID REFERENCES suppliers(id),
  purchase_order_id UUID REFERENCES purchase_orders(id),
  received_line_id UUID REFERENCES grn_items(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_batches_product_batch
  ON inventory_batches (product_id, batch_number);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_warehouse
  ON inventory_batches (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_qty_available
  ON inventory_batches (quantity_available);

CREATE TABLE IF NOT EXISTS label_print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type VARCHAR(50) NOT NULL,
  source_id UUID NOT NULL,
  label_type VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  printed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_label_print_jobs_source
  ON label_print_jobs (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_label_print_jobs_status
  ON label_print_jobs (status);

CREATE TABLE IF NOT EXISTS customer_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES clients(id),
  product_id UUID NOT NULL REFERENCES products(id),
  inventory_item_id UUID NOT NULL REFERENCES serial_numbers(id),
  serial_number VARCHAR(100),
  sale_id UUID REFERENCES sale_orders(id),
  warranty_start DATE,
  warranty_end DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_assets_customer
  ON customer_assets (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_assets_inventory_item
  ON customer_assets (inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_customer_assets_sale
  ON customer_assets (sale_id);
