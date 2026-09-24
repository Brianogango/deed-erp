-- Contact-person fields the application has always carried but the table could
-- not store, so they were dropped on the first server broadcast: department,
-- mobile, LinkedIn, the four role flags and the preferred channel. Also widens
-- phone, where VARCHAR(20) errored rather than truncated on a number carrying
-- a country code and an extension.
--
-- Additive only; safe to re-run.
-- Rollback:
--   ALTER TABLE contact_persons
--     DROP COLUMN IF EXISTS department,
--     DROP COLUMN IF EXISTS mobile,
--     DROP COLUMN IF EXISTS linked_in,
--     DROP COLUMN IF EXISTS is_primary,
--     DROP COLUMN IF EXISTS is_decision_maker,
--     DROP COLUMN IF EXISTS is_technical_contact,
--     DROP COLUMN IF EXISTS is_billing_contact,
--     DROP COLUMN IF EXISTS preferred_channel;
--   (phone stays widened — narrowing it again would fail on longer values.)

ALTER TABLE contact_persons
  ADD COLUMN IF NOT EXISTS department           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS mobile               VARCHAR(40),
  ADD COLUMN IF NOT EXISTS linked_in            VARCHAR(200),
  ADD COLUMN IF NOT EXISTS is_primary           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_decision_maker    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_technical_contact BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_billing_contact   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS preferred_channel    VARCHAR(20);

ALTER TABLE contact_persons
  ALTER COLUMN phone TYPE VARCHAR(40);
