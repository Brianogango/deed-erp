-- Multi-currency, pricelists, and gated blob cutover foundation
-- SAFE / NON-DESTRUCTIVE:
--   * CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / ADD COLUMN IF NOT EXISTS only
--   * Never DROP, TRUNCATE, or DELETE app_state keys
--   * Functional currency remains KES; document currency columns default to KES
-- Apply with: node scripts/run-safe-currency-pricelists-cutover.mjs
-- Contabo (when deed_user lacks DDL): apply as OS postgres, then GRANT to deed_user.

-- ── Exchange rates (to functional KES) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency   VARCHAR(3) NOT NULL,
  to_currency     VARCHAR(3) NOT NULL DEFAULT 'KES',
  rate            NUMERIC(18, 8) NOT NULL,
  effective_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  source          VARCHAR(80),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_exchange_rates_rate_positive CHECK (rate > 0),
  CONSTRAINT chk_exchange_rates_to_kes CHECK (to_currency = 'KES')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exchange_rates_pair_day
  ON exchange_rates (from_currency, to_currency, effective_date);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_from ON exchange_rates (from_currency);

-- Seed identity rate for KES (idempotent)
INSERT INTO exchange_rates (from_currency, to_currency, rate, effective_date, source)
VALUES ('KES', 'KES', 1, DATE '2020-01-01', 'system')
ON CONFLICT DO NOTHING;

-- ── Price lists ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_lists (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(40) NOT NULL UNIQUE,
  name            VARCHAR(120) NOT NULL,
  currency_code   VARCHAR(3) NOT NULL DEFAULT 'KES',
  price_source    VARCHAR(40) NOT NULL DEFAULT 'selling_price',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 100,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_list_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id     UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES products(id) ON DELETE CASCADE,
  unit_price        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  minimum_qty       INT NOT NULL DEFAULT 1,
  maximum_discount  NUMERIC(5, 2) NOT NULL DEFAULT 0,
  valid_from        DATE,
  valid_until       DATE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_list ON price_list_items (price_list_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_product ON price_list_items (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_list_items_list_product_qty
  ON price_list_items (price_list_id, product_id, minimum_qty)
  WHERE product_id IS NOT NULL;

INSERT INTO price_lists (code, name, currency_code, price_source, is_active, sort_order)
VALUES
  ('RETAIL', 'Retail', 'KES', 'selling_price', TRUE, 10),
  ('WHOLESALE', 'Wholesale', 'KES', 'wholesale_price', TRUE, 20),
  ('KILIMALL', 'Kilimall', 'KES', 'kilimall_price', TRUE, 30)
ON CONFLICT (code) DO NOTHING;

-- ── Document currency snapshots (additive columns) ───────────────────────────
ALTER TABLE sale_orders
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS base_currency_code VARCHAR(3) NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS exchange_rate_to_base NUMERIC(18, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pricelist_id UUID REFERENCES price_lists(id) ON DELETE SET NULL;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS base_currency_code VARCHAR(3) NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS exchange_rate_to_base NUMERIC(18, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pricelist VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pricelist_id UUID REFERENCES price_lists(id) ON DELETE SET NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS base_currency_code VARCHAR(3) NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS exchange_rate_to_base NUMERIC(18, 8) NOT NULL DEFAULT 1;

-- ── Blob cutover certificates (gated archive — never blind delete) ───────────
CREATE TABLE IF NOT EXISTS blob_cutover_certificates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blob_key        VARCHAR(120) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  blob_count      INT,
  prisma_count    INT,
  parity_ok       BOOLEAN NOT NULL DEFAULT FALSE,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  certified_by    VARCHAR(80),
  certified_at    TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  archive_key     VARCHAR(200),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_blob_cutover_active_key
  ON blob_cutover_certificates (blob_key)
  WHERE status IN ('verified', 'certified', 'archived', 'blocked');

CREATE INDEX IF NOT EXISTS idx_blob_cutover_status ON blob_cutover_certificates (status);
