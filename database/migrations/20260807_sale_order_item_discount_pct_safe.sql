-- Migration: persist per-line discount percent on sale order items
--
-- SaleOrderItem.lineTotal already bakes in a line's discount at write time
-- (qty x unitPrice x (1 - discount% / 100)), but the discount PERCENT itself
-- was never stored — only derivable, lossily, by reverse-computing it from
-- lineTotal/qty/unitPrice. Two concrete bugs followed from this:
--
-- 1. Reopening/editing an existing sale-order line after a page reload
--    showed 0% discount (the client never received it back from the API),
--    so saving the line unchanged silently erased the original discount.
-- 2. create-invoice-from-so rebuilds each invoice line from item.unitPrice x
--    qty directly, with no way to reapply a line discount that only ever
--    lived in lineTotal — so line-level discounts were never honored on the
--    invoice at all (only the SO's separate HEADER discount is prorated).
--
-- Purely additive (new column, default 0); safe to re-run.

BEGIN;

ALTER TABLE sale_order_items
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0;

COMMIT;
