-- Migration: sales inbound email processing + lead thread linkage
-- Additive / safe to re-run.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS inbound_thread_id VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_leads_inbound_thread_id
  ON leads (inbound_thread_id)
  WHERE inbound_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_inbound_emails (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          VARCHAR(20)  NOT NULL DEFAULT 'IMAP',
  mailbox           VARCHAR(200) NOT NULL,
  provider_message_id VARCHAR(500) NOT NULL,
  provider_thread_id  VARCHAR(500),
  internet_message_id VARCHAR(500),
  from_email        VARCHAR(150),
  from_name         VARCHAR(200),
  subject           VARCHAR(500),
  received_at       TIMESTAMPTZ,
  processing_status VARCHAR(40)  NOT NULL DEFAULT 'RECEIVED',
  processing_reason VARCHAR(200),
  classification    VARCHAR(60),
  confidence        DECIMAL(5,4),
  classifier_version VARCHAR(40),
  lead_id           UUID REFERENCES leads(id) ON DELETE SET NULL,
  client_id         UUID,
  decision          VARCHAR(40),
  raw_meta          JSONB,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_inbound_emails_provider_msg_uniq
    UNIQUE (provider, mailbox, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_inbound_emails_thread
  ON sales_inbound_emails (provider, provider_thread_id)
  WHERE provider_thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_inbound_emails_status
  ON sales_inbound_emails (processing_status);

CREATE INDEX IF NOT EXISTS idx_sales_inbound_emails_lead
  ON sales_inbound_emails (lead_id)
  WHERE lead_id IS NOT NULL;

COMMIT;
