-- What came with a vendor device: charger above all, and bag, mouse, box or
-- anything else. Recorded at book-in so the same things go back when the vendor
-- collects, and so a buyer knows whether a charger is included.
--
-- Apply BEFORE deploying the code that reads it: the register selects every
-- column, so without this one the Vendor stock tab would fail to load.
ALTER TABLE consignment_devices
  ADD COLUMN IF NOT EXISTS accessories jsonb NOT NULL DEFAULT '[]'::jsonb;
