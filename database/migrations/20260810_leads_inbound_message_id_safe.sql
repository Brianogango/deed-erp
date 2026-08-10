-- Migration: inbound sales-inbox Message-ID dedupe on leads
-- Purely additive; safe to re-run.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS inbound_message_id VARCHAR(500);

CREATE UNIQUE INDEX IF NOT EXISTS leads_inbound_message_id_key
  ON leads (inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

COMMIT;
