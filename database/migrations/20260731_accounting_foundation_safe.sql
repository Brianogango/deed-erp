-- Accounting + valuation + reservations + approval rules foundation
-- SAFE / NON-DESTRUCTIVE:
--   * CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only
--   * Never DROP, TRUNCATE, or DELETE app_state keys
--   * Partial unique on active stock reservations only (cancelled/released can repeat)
-- Apply with: node scripts/run-safe-accounting-foundation.mjs

-- ── Chart of accounts (mirrors deed_accounts by business `code`) ─────────────
CREATE TABLE IF NOT EXISTS account_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(20) NOT NULL UNIQUE,
  name            VARCHAR(200) NOT NULL,
  account_type    VARCHAR(20) NOT NULL,
  account_group   VARCHAR(120),
  sub_group       VARCHAR(120),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_dynamic      BOOLEAN NOT NULL DEFAULT FALSE,
  dynamic_key     VARCHAR(40),
  balance         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_codes_type ON account_codes (account_type);

-- ── Journals (books) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR(10) NOT NULL UNIQUE,
  name       VARCHAR(100) NOT NULL,
  journal_type VARCHAR(20) NOT NULL DEFAULT 'general',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO journals (code, name, journal_type)
VALUES
  ('SAL', 'Sales Journal', 'sale'),
  ('PUR', 'Purchase Journal', 'purchase'),
  ('BNK', 'Bank Journal', 'bank'),
  ('CSH', 'Cash Journal', 'cash'),
  ('STK', 'Stock Journal', 'stock'),
  ('PAY', 'Payroll Journal', 'payroll'),
  ('GEN', 'Miscellaneous', 'general')
ON CONFLICT (code) DO NOTHING;

-- ── Journal entries (mirrors deed_journalEntries by business `ref`) ──────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             VARCHAR(80) NOT NULL UNIQUE,
  journal_id      UUID REFERENCES journals(id),
  entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  description     TEXT,
  source_type     VARCHAR(40),
  source_id       VARCHAR(80),
  is_posted       BOOLEAN NOT NULL DEFAULT TRUE,
  posted_at       TIMESTAMPTZ,
  posted_by_id    UUID,
  is_reversed     BOOLEAN NOT NULL DEFAULT FALSE,
  reversal_of_id  UUID REFERENCES journal_entries(id),
  invoice_id      UUID,
  payment_id      UUID,
  blob_id         VARCHAR(80),
  total_debit     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_credit    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_by_id   UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_invoice ON journal_entries (invoice_id);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id        UUID REFERENCES account_codes(id),
  account_label     VARCHAR(200) NOT NULL,
  label             VARCHAR(300),
  debit             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  credit            NUMERIC(14, 2) NOT NULL DEFAULT 0,
  partner_id        UUID,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines (account_id);

-- ── Product valuation (weighted average) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_valuations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  average_cost   NUMERIC(14, 4) NOT NULL DEFAULT 0,
  total_qty      INT NOT NULL DEFAULT 0,
  total_value    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency for receipt/delivery valuation (never double-apply avg cost)
CREATE TABLE IF NOT EXISTS valuation_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key    VARCHAR(120) NOT NULL UNIQUE,
  kind         VARCHAR(20) NOT NULL,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  qty          INT NOT NULL DEFAULT 0,
  unit_cost    NUMERIC(14, 4) NOT NULL DEFAULT 0,
  reference    VARCHAR(80),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valuation_events_product ON valuation_events (product_id);

-- ── Stock reservations (app_state deed_stockReservations dual-write) ─────────
CREATE TABLE IF NOT EXISTS stock_reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_id         VARCHAR(80),
  sale_order_id   UUID,
  sale_order_ref  VARCHAR(40),
  product_id      UUID REFERENCES products(id),
  serial_id       UUID REFERENCES serial_numbers(id),
  qty             INT NOT NULL DEFAULT 1,
  location        VARCHAR(30) NOT NULL DEFAULT 'warehouse',
  reserved_for    VARCHAR(40),
  reference_id    VARCHAR(80),
  reference_ref   VARCHAR(80),
  status          VARCHAR(20) NOT NULL DEFAULT 'reserved',
  reserved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_so ON stock_reservations (sale_order_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_product ON stock_reservations (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_blob ON stock_reservations (blob_id);

-- One ACTIVE reservation per serial only (cancelled/released may repeat)
CREATE UNIQUE INDEX IF NOT EXISTS uq_serial_active_reservation
  ON stock_reservations (serial_id)
  WHERE serial_id IS NOT NULL AND status = 'reserved';

-- ── Configurable approval thresholds ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_type   VARCHAR(40) NOT NULL UNIQUE,
  thresholds      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO approval_rules (approval_type, thresholds, is_active)
VALUES
  ('discount', '[
    {"maxValue": 10, "requiredRoles": []},
    {"maxValue": 20, "requiredRoles": ["director"]},
    {"maxValue": 999999, "requiredRoles": ["director", "finance_officer"]}
  ]'::jsonb, TRUE),
  ('special_pricing', '[{"maxValue": 999999, "requiredRoles": ["director"]}]'::jsonb, TRUE),
  ('credit_override', '[
    {"maxValue": 0, "requiredRoles": []},
    {"maxValue": 100000, "requiredRoles": ["finance_officer"]},
    {"maxValue": 999999999, "requiredRoles": ["finance_officer", "director"]}
  ]'::jsonb, TRUE),
  ('corporate_deal', '[{"maxValue": 999999, "requiredRoles": ["director"]}]'::jsonb, TRUE),
  ('backorder', '[
    {"maxValue": 10, "requiredRoles": ["technical_lead"]},
    {"maxValue": 999999, "requiredRoles": ["technical_lead", "director"]}
  ]'::jsonb, TRUE)
ON CONFLICT (approval_type) DO NOTHING;
