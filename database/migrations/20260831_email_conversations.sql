-- Email conversation support on top of the existing SMS communication ledger.
-- Additive / backward-compatible: existing SMS rows remain valid.

ALTER TABLE communication_threads
  ALTER COLUMN participant_phone DROP NOT NULL;

ALTER TABLE communication_threads
  ADD COLUMN IF NOT EXISTS participant_email VARCHAR(320),
  ADD COLUMN IF NOT EXISTS mailbox VARCHAR(80),
  ADD COLUMN IF NOT EXISTS subject VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_comm_threads_email_last
  ON communication_threads (participant_email, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_comm_threads_mailbox_last
  ON communication_threads (mailbox, last_message_at DESC);

ALTER TABLE communication_messages
  ADD COLUMN IF NOT EXISTS subject VARCHAR(500),
  ADD COLUMN IF NOT EXISTS internet_message_id VARCHAR(500),
  ADD COLUMN IF NOT EXISTS in_reply_to VARCHAR(500),
  ADD COLUMN IF NOT EXISTS sender_email VARCHAR(320),
  ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(320);

CREATE INDEX IF NOT EXISTS idx_comm_messages_internet_message_id
  ON communication_messages (internet_message_id);

CREATE INDEX IF NOT EXISTS idx_comm_messages_sender_email
  ON communication_messages (sender_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comm_messages_recipient_email
  ON communication_messages (recipient_email, created_at DESC);
