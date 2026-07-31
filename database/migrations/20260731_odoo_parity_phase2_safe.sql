-- Odoo parity Phase 2: qty_billed, optimistic locking, shared chatter
-- SAFE / NON-DESTRUCTIVE: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS only

-- ── Purchase 3-way match: qty billed on PO lines ─────────────────────────────
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS qty_billed INT NOT NULL DEFAULT 0;

-- ── Optimistic concurrency on commercial documents ─────────────────────────────
ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS lock_version INT NOT NULL DEFAULT 0;

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS lock_version INT NOT NULL DEFAULT 0;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS lock_version INT NOT NULL DEFAULT 0;

-- ── Shared document chatter (polymorphic) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model         VARCHAR(40) NOT NULL,
  record_id     VARCHAR(80) NOT NULL,
  body          TEXT NOT NULL,
  author_id     UUID,
  author_name   VARCHAR(120),
  message_type  VARCHAR(20) NOT NULL DEFAULT 'comment',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_messages_record
  ON document_messages (model, record_id);

CREATE TABLE IF NOT EXISTS document_activities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model           VARCHAR(40) NOT NULL,
  record_id       VARCHAR(80) NOT NULL,
  activity_type   VARCHAR(20) NOT NULL,
  summary         TEXT NOT NULL,
  due_date        TIMESTAMPTZ,
  user_id         UUID,
  status          VARCHAR(20) NOT NULL DEFAULT 'planned',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_activities_record
  ON document_activities (model, record_id);
