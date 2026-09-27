-- 012: release control can hand back a device Deed never sold.
--
-- outbound_release_items.serial_number_id was NOT NULL with a foreign key to
-- serial_numbers, so only units in Deed's own serial register could be
-- released. A customer's own laptop in for repair is by definition not in that
-- register, so the release panel refused every walk-in repair — "these units
-- are not in the serial register" for a device with an unregistered serial,
-- and "clientId and serials are required" for one with no serial at all.
--
-- The column is only an inventory link. Verification compares the serial the
-- storekeeper reads off the device (confirmed_serial) against the one recorded
-- at intake (expected_serial), and that works whether or not the unit is in
-- stock. So the link becomes optional and expected_serial carries the
-- identity for customer-owned devices.
--
-- Releases of Deed stock still require the link; that rule now lives in the
-- API, which knows whether the source document is a repair or a sale.
--
-- Safe to re-run.

ALTER TABLE outbound_release_items
  ALTER COLUMN serial_number_id DROP NOT NULL;
