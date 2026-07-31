-- Deposits + holdovers relational foundation (SAFE / NON-DESTRUCTIVE)
-- Never DROP / DELETE app_state keys. Blobs remain operational SoT.
-- Apply as OS postgres on Contabo, then GRANT to deed_user.

CREATE TABLE IF NOT EXISTS deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_id         VARCHAR(80),
  ref             VARCHAR(40) NOT NULL,
  customer_id     VARCHAR(80),
  customer_name   VARCHAR(200),
  customer_phone  VARCHAR(40),
  total_value     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_paid      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  balance         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status          VARCHAR(30) NOT NULL DEFAULT 'active',
  notes           TEXT,
  due_date        DATE,
  completed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  created_by      VARCHAR(80),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deposits_ref ON deposits (ref);
CREATE INDEX IF NOT EXISTS idx_deposits_blob ON deposits (blob_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits (status);

CREATE TABLE IF NOT EXISTS deposit_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id   UUID NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  product_id   VARCHAR(80),
  product_name VARCHAR(200),
  sku          VARCHAR(80),
  qty          INT NOT NULL DEFAULT 1,
  unit_price   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  line_total   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sort_order   INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_deposit_items_deposit ON deposit_items (deposit_id);

CREATE TABLE IF NOT EXISTS deposit_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id   UUID NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  blob_id      VARCHAR(80),
  amount       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  method       VARCHAR(40) NOT NULL DEFAULT 'cash',
  payment_ref  VARCHAR(80),
  recorded_by  VARCHAR(80),
  paid_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposit_payments_deposit ON deposit_payments (deposit_id);

CREATE TABLE IF NOT EXISTS holdovers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_id            VARCHAR(80),
  ref                VARCHAR(40) NOT NULL,
  customer_id        VARCHAR(80),
  customer_name      VARCHAR(200),
  customer_phone     VARCHAR(40),
  product_id         VARCHAR(80),
  product_name       VARCHAR(200),
  serial_id          VARCHAR(80),
  serial_number      VARCHAR(120),
  device_condition   VARCHAR(40),
  purpose            VARCHAR(40),
  status             VARCHAR(30) NOT NULL DEFAULT 'active',
  issued_at          TIMESTAMPTZ,
  due_at             TIMESTAMPTZ,
  returned_at        TIMESTAMPTZ,
  return_condition   VARCHAR(40),
  notes              TEXT,
  created_by         VARCHAR(80),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_holdovers_ref ON holdovers (ref);
CREATE INDEX IF NOT EXISTS idx_holdovers_blob ON holdovers (blob_id);
CREATE INDEX IF NOT EXISTS idx_holdovers_status ON holdovers (status);
