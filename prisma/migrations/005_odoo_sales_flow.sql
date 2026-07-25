-- Migration: Odoo-style quotation-to-payment workflow
--
-- Sale order states become: quotation | quotation_sent | sale | cancelled.
-- Fulfilment progress ("delivered"/"invoiced") no longer lives in the sale
-- order status: it is carried by qty_delivered and the new per-line
-- qty_invoiced ledger. The approval gate ("pending_approval"/"approved")
-- becomes an approval flag on the client record, not a status.
--
-- All changes are additive; the status backfill is a value rewrite that maps
-- every legacy status onto its Odoo-equivalent stage without losing records.

BEGIN;

-- 1. New sale-order columns -------------------------------------------------
ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS valid_until       DATE,
  ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sent_by           UUID,
  ADD COLUMN IF NOT EXISTS sent_to           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS confirmed_at      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS confirmed_by      UUID,
  ADD COLUMN IF NOT EXISTS locked            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS customer_ref      VARCHAR(120),
  ADD COLUMN IF NOT EXISTS invoice_address   TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address  TEXT;

-- 2. Per-line invoiced-quantity ledger ---------------------------------------
ALTER TABLE sale_order_items
  ADD COLUMN IF NOT EXISTS qty_invoiced INTEGER NOT NULL DEFAULT 0;

-- 3. Product invoicing policy (Odoo: Ordered vs Delivered Quantities) --------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS invoice_policy VARCHAR(20) NOT NULL DEFAULT 'order';

-- 4. Backfill qty_invoiced BEFORE the status rewrite -------------------------
-- Legacy invoicing always invoiced the full ordered quantity, so any order
-- with a non-draft, non-cancelled linked invoice is fully invoiced.
UPDATE sale_order_items i
SET    qty_invoiced = i.qty
FROM   sale_orders s
WHERE  i.sale_order_id = s.id
  AND  i.qty_invoiced = 0
  AND (
    s.status = 'invoiced'
    OR EXISTS (
      SELECT 1 FROM invoices inv
      WHERE inv.sale_order_id = s.id
        AND inv.status NOT IN ('draft', 'cancelled', 'voided', 'rejected')
    )
  );

-- 5. Approximate confirmation timestamps for already-confirmed orders --------
UPDATE sale_orders
SET    confirmed_at = updated_at
WHERE  confirmed_at IS NULL
  AND  status IN ('confirmed', 'delivered', 'invoiced', 'reserved', 'paid');

-- 6. Status rewrite onto the Odoo vocabulary ---------------------------------
UPDATE sale_orders SET status = 'sale'
WHERE  status IN ('confirmed', 'delivered', 'invoiced', 'reserved', 'paid');

UPDATE sale_orders SET status = 'quotation'
WHERE  status IN ('pending', 'draft', 'pending_approval', 'approved', 'on_hold')
   OR  status NOT IN ('quotation', 'quotation_sent', 'sale', 'cancelled');

-- 7. New default for future rows ----------------------------------------------
ALTER TABLE sale_orders ALTER COLUMN status SET DEFAULT 'quotation';

COMMIT;
