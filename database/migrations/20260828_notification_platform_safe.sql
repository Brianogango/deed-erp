-- Deed ERP notification platform foundation
-- SAFE / NON-DESTRUCTIVE:
--   * creates relational notification/outbox/delivery tables only
--   * leaves legacy app_state notification blobs untouched for rollback/backfill
--   * adds LISTEN/NOTIFY trigger for real-time bell updates
-- Apply with: node scripts/run-safe-notification-platform.mjs

CREATE TABLE IF NOT EXISTS notification_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type                VARCHAR(120) NOT NULL,
  entity_type               VARCHAR(80),
  entity_id                 VARCHAR(160),
  actor_user_id             UUID,
  severity                  VARCHAR(20) NOT NULL DEFAULT 'info',
  priority                  VARCHAR(20) NOT NULL DEFAULT 'normal',
  title                     VARCHAR(240) NOT NULL,
  body                      TEXT NOT NULL,
  action_url                TEXT,
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  routing                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key           VARCHAR(240) NOT NULL UNIQUE,
  requires_acknowledgement  BOOLEAN NOT NULL DEFAULT FALSE,
  due_at                    TIMESTAMPTZ,
  escalate_at               TIMESTAMPTZ,
  resolved_at               TIMESTAMPTZ,
  resolved_by_id            UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_type_created
  ON notification_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_events_entity
  ON notification_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_unresolved
  ON notification_events (created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_events_escalation
  ON notification_events (escalate_at)
  WHERE resolved_at IS NULL AND escalate_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_recipients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at           TIMESTAMPTZ,
  acknowledged_at   TIMESTAMPTZ,
  acknowledged_by   UUID,
  dismissed_at      TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_recipients_user_created
  ON notification_recipients (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_recipients_user_unread
  ON notification_recipients (user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL UNIQUE REFERENCES notification_events(id) ON DELETE CASCADE,
  status            VARCHAR(30) NOT NULL DEFAULT 'queued',
  attempt_count     INT NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at         TIMESTAMPTZ,
  locked_by         VARCHAR(120),
  last_error        TEXT,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
  ON notification_outbox (next_attempt_at, created_at)
  WHERE status IN ('queued', 'retrying');

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  recipient_id          UUID REFERENCES notification_recipients(id) ON DELETE SET NULL,
  user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  channel               VARCHAR(20) NOT NULL,
  destination           VARCHAR(500),
  provider              VARCHAR(40),
  provider_message_id   VARCHAR(500),
  status                VARCHAR(30) NOT NULL DEFAULT 'queued',
  attempt_count         INT NOT NULL DEFAULT 0,
  next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at       TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  read_at               TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  last_error            TEXT,
  idempotency_key       VARCHAR(240) NOT NULL UNIQUE,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
  ON notification_deliveries (next_attempt_at, created_at)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_provider_message
  ON notification_deliveries (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_event
  ON notification_deliveries (event_id, channel);

CREATE TABLE IF NOT EXISTS notification_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id       UUID NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  attempt_no        INT NOT NULL,
  status            VARCHAR(30) NOT NULL,
  provider          VARCHAR(40),
  provider_response JSONB,
  error_code        VARCHAR(100),
  error             TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  UNIQUE (delivery_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_delivery
  ON notification_attempts (delivery_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type          VARCHAR(120) NOT NULL DEFAULT '*',
  in_app_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  whatsapp_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  sms_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  sound_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  digest_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_start         VARCHAR(5),
  quiet_end           VARCHAR(5),
  timezone            VARCHAR(80) NOT NULL DEFAULT 'Africa/Nairobi',
  minimum_severity    VARCHAR(20) NOT NULL DEFAULT 'info',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences (user_id);

CREATE TABLE IF NOT EXISTS notification_endpoints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              VARCHAR(30) NOT NULL DEFAULT 'web_push',
  endpoint          TEXT NOT NULL,
  p256dh            TEXT,
  auth_secret       TEXT,
  device_label      VARCHAR(120),
  user_agent        TEXT,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_endpoint_active
  ON notification_endpoints (user_id, endpoint)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_endpoints_user_active
  ON notification_endpoints (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        VARCHAR(120) NOT NULL,
  channel           VARCHAR(20) NOT NULL,
  version           INT NOT NULL DEFAULT 1,
  subject_template  TEXT,
  body_template     TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_type, channel, version)
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_active
  ON notification_templates (event_type, channel)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS notification_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  level             INT NOT NULL DEFAULT 1,
  target_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  status            VARCHAR(30) NOT NULL DEFAULT 'queued',
  escalated_at      TIMESTAMPTZ,
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, level, target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_escalations_pending
  ON notification_escalations (created_at)
  WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS notification_dead_letters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id       UUID NOT NULL UNIQUE REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  reason            TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  resolved_by_id    UUID,
  resolution_note   TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_dead_letters_open
  ON notification_dead_letters (created_at DESC)
  WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION deed_notify_notification_recipient_change()
RETURNS trigger AS $$
DECLARE
  target_user UUID;
BEGIN
  target_user := COALESCE(NEW.user_id, OLD.user_id);
  PERFORM pg_notify('deed_notifications_changed', COALESCE(target_user::text, ''));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_recipient_notify ON notification_recipients;
CREATE TRIGGER trg_notification_recipient_notify
AFTER INSERT OR UPDATE OR DELETE ON notification_recipients
FOR EACH ROW EXECUTE FUNCTION deed_notify_notification_recipient_change();
