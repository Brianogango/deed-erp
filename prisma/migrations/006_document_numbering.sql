-- Migration: standard document numbering (QUO/SO/PI/DN/INV/RCT/CN/PO)
--
-- Sale orders keep their original quotation number after confirmation assigns
-- a fresh SO number, and remember the pro-forma invoice number assigned the
-- first time a pro-forma is issued. Both are additive, nullable columns.

BEGIN;

ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS quotation_ref VARCHAR(30),
  ADD COLUMN IF NOT EXISTS proforma_ref  VARCHAR(30);

COMMIT;
