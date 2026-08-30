-- SMS conversation ledger
-- Additive migration: no existing notification data is removed or rewritten.

CREATE TABLE IF NOT EXISTS communication_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_key varchar(240) NOT NULL UNIQUE,
  channel varchar(20) NOT NULL DEFAULT 'sms',
  participant_phone varchar(40) NOT NULL,
  participant_name varchar(200),
  entity_type varchar(80),
  entity_id varchar(160),
  status varchar(30) NOT NULL DEFAULT 'open',
  unread_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_threads_phone_last
  ON communication_threads (participant_phone, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_threads_entity
  ON communication_threads (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comm_threads_last_message
  ON communication_threads (last_message_at DESC);

CREATE TABLE IF NOT EXISTS communication_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES communication_threads(id) ON DELETE CASCADE,
  direction varchar(12) NOT NULL,
  channel varchar(20) NOT NULL DEFAULT 'sms',
  body text NOT NULL,
  provider varchar(40),
  provider_message_id varchar(500),
  provider_message_key varchar(560) UNIQUE,
  notification_delivery_id uuid UNIQUE,
  event_type varchar(120),
  entity_type varchar(80),
  entity_id varchar(160),
  sender_phone varchar(40),
  recipient_phone varchar(40),
  status varchar(30) NOT NULL DEFAULT 'queued',
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  received_at timestamptz,
  created_by_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_messages_thread_created
  ON communication_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comm_messages_provider_message
  ON communication_messages (provider, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_comm_messages_direction_status
  ON communication_messages (direction, status, created_at DESC);
