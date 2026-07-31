-- Odoo parity Phase 4: leads, product costing method, expense approval rule
-- Safe / idempotent — IF NOT EXISTS only

-- ── Leads ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  company_name    VARCHAR(200),
  email           VARCHAR(150),
  phone           VARCHAR(20),
  source          VARCHAR(50),
  stage           VARCHAR(30) NOT NULL DEFAULT 'new',
  owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  opportunity_id  UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads (stage);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads (owner_id);

-- ── Product costing method (average | fifo | standard) ──────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS costing_method VARCHAR(20) NOT NULL DEFAULT 'average';

-- ── Expense approval thresholds ─────────────────────────────────────────────
INSERT INTO approval_rules (approval_type, thresholds, is_active)
VALUES (
  'expense',
  '[
    {"maxValue": 50000, "requiredRoles": ["finance_officer"]},
    {"maxValue": 999999999, "requiredRoles": ["finance_officer", "director"]}
  ]'::jsonb,
  TRUE
)
ON CONFLICT (approval_type) DO NOTHING;
