-- Additive inbound-email context columns for CRM leads.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_subject VARCHAR(500);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_snippet VARCHAR(500);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_body TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_received_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_attachments JSONB;
