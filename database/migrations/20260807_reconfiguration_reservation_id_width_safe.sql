-- Migration: widen reconfiguration reservation id columns
--
-- `rsv_rcf_<work-order-uuid>_<line-uuid>` is always exactly 81 characters
-- (8 + 36 + 1 + 36), but reconfiguration_installation_lines.reservation_id
-- and stock_reservations.blob_id were VarChar(80) — every single "Reserve"
-- click on a device reconfiguration work order with at least one
-- installation line failed with a Postgres "value too long" error,
-- surfaced to users as a generic "Internal server error".
--
-- Purely additive (widening a column never loses data); safe to re-run.

BEGIN;

ALTER TABLE reconfiguration_installation_lines
  ALTER COLUMN reservation_id TYPE VARCHAR(120);

ALTER TABLE stock_reservations
  ALTER COLUMN blob_id TYPE VARCHAR(120);

COMMIT;
