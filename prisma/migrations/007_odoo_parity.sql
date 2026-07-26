-- Migration: Odoo-parity refinements to the quotation-to-payment workflow
--
-- 1. Quotation form fields that Odoo carries on the sale order: pricelist,
--    salesperson, sales team, and the email message recorded when a
--    quotation is sent.
-- 2. Invoices carry the invoice/delivery addresses forward from the order,
--    and a finance dispute flag (Odoo's "Blocked" payment status).
-- 3. The stored invoice status becomes a pure document state
--    (draft | posted/approved | cancelled). Payment progress is derived from
--    amount_paid/total at read time, so 'paid' / 'partially_paid' document
--    statuses collapse onto the posted state without losing anything —
--    amount_paid still carries the payment history.

BEGIN;

ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS pricelist        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS salesperson_id   UUID,
  ADD COLUMN IF NOT EXISTS salesperson_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS sales_team       VARCHAR(120),
  ADD COLUMN IF NOT EXISTS sent_message     TEXT;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_address  TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS payment_blocked  BOOLEAN NOT NULL DEFAULT FALSE;

-- Separate the document state from payment progress. Compare as text so this
-- works on databases whose enum predates some values.
UPDATE invoices SET status = 'approved'
WHERE  status::text IN ('paid', 'partially_paid');

COMMIT;
