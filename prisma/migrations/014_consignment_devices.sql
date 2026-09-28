-- Vendor devices held at the shop that Deed has not bought.
--
-- A vendor leaves laptops so they can be shown to clients. Deed buys one only
-- when a client agrees; the rest are collected. The same arrangement as the
-- Computer Aid channel — stock on the floor, paid for on sell-through.
--
-- Deliberately NOT serial_numbers. Everything that reads that table treats what
-- it finds as Deed's stock, so a vendor's machine parked there would be counted
-- in stock valuation and on the balance sheet as an asset the company does not
-- own. This table is a custody register: what is here, whose it is, since when,
-- and how it left. Nothing in it reaches the ledger. A purchase does, and that
-- goes through the normal purchase-order route.

CREATE TABLE IF NOT EXISTS consignment_devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         uuid NOT NULL REFERENCES clients(id),
  vendor_name       varchar(200),
  -- The vendor's own asset tag: how THEY identify the machine. Nullable, so a
  -- device that arrives untagged is still on the register rather than missing
  -- from it; the application flags those for chasing.
  asset_id          varchar(120),
  serial_number     varchar(100) NOT NULL,
  product_id        uuid REFERENCES products(id),
  product_name      varchar(300),
  condition_grade   varchar(30),
  received_at       date NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'at_shop',
  purchased_at      date,
  purchase_order_id uuid REFERENCES purchase_orders(id),
  purchase_price    numeric(14,2),
  returned_at       date,
  notes             text,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consignment_devices_status_check
    CHECK (status IN ('at_shop', 'purchased', 'returned'))
);

CREATE INDEX IF NOT EXISTS idx_consignment_vendor ON consignment_devices (vendor_id);
CREATE INDEX IF NOT EXISTS idx_consignment_status ON consignment_devices (status);
CREATE INDEX IF NOT EXISTS idx_consignment_serial ON consignment_devices (upper(serial_number));

-- The same machine cannot be on the floor twice. A duplicate almost always
-- means an earlier visit was never checked out, which is the precise confusion
-- this register exists to prevent. Partial, so a device can legitimately come
-- back after being collected or bought.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consignment_open_serial
  ON consignment_devices (upper(serial_number))
  WHERE status = 'at_shop';
