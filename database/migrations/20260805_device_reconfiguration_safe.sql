-- Device Reconfiguration foundation
-- SAFE / NON-DESTRUCTIVE:
--   * CREATE TYPE / TABLE / INDEX IF NOT EXISTS only
--   * Never DROP, TRUNCATE, or DELETE app_state keys
-- Apply with: node scripts/run-safe-device-reconfiguration.mjs

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reconfig_transaction_type') THEN
    CREATE TYPE reconfig_transaction_type AS ENUM (
      'downgrade_for_sale',
      'upgrade_for_sale',
      'customer_paid_upgrade',
      'internal_refurbishment',
      'component_replacement',
      'warranty_replacement',
      'repair_related',
      'configuration_correction',
      'stock_standardisation'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reconfig_status') THEN
    CREATE TYPE reconfig_status AS ENUM (
      'draft',
      'pending_stock_check',
      'components_reserved',
      'pending_approval',
      'approved',
      'in_progress',
      'pending_qa',
      'completed',
      'cancelled',
      'reversed'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'component_slot_type') THEN
    CREATE TYPE component_slot_type AS ENUM (
      'ram_slot',
      'm2_slot',
      'sata_bay',
      'battery',
      'keyboard',
      'wifi_card',
      'charger',
      'other'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'component_disposition') THEN
    CREATE TYPE component_disposition AS ENUM (
      'quarantine',
      'pending_testing',
      'ready_for_sale',
      'repair_required',
      'parts_harvesting',
      'damaged',
      'write_off',
      'supplier_return'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_status') THEN
    CREATE TYPE data_status AS ENUM (
      'unknown',
      'none',
      'company',
      'client',
      'test',
      'awaiting_backup',
      'awaiting_sanitisation',
      'sanitised',
      'sanitisation_failed',
      'physical_destruction_required'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'installation_status') THEN
    CREATE TYPE installation_status AS ENUM (
      'installed',
      'removed',
      'quarantined'
    );
  END IF;
END $$;

-- ── Device serial cost basis (specific identification) ────────────────────────
CREATE TABLE IF NOT EXISTS device_serial_costs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_id     UUID NOT NULL UNIQUE REFERENCES serial_numbers(id) ON DELETE CASCADE,
  current_cost  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency_code VARCHAR(3) NOT NULL DEFAULT 'KES',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_device_serial_costs_serial
  ON device_serial_costs (serial_id);

-- ── Configuration snapshots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_configuration_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_id             UUID NOT NULL REFERENCES serial_numbers(id) ON DELETE CASCADE,
  processor             VARCHAR(120),
  processor_generation  VARCHAR(80),
  total_ram_gb          INTEGER NOT NULL DEFAULT 0,
  ram_composition       JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_storage_gb    INTEGER,
  secondary_storage_gb  INTEGER,
  storage_type          VARCHAR(40),
  screen_size           VARCHAR(40),
  screen_resolution     VARCHAR(40),
  touchscreen           BOOLEAN,
  graphics              VARCHAR(120),
  operating_system      VARCHAR(120),
  keyboard_layout       VARCHAR(40),
  colour                VARCHAR(40),
  included_accessories  JSONB NOT NULL DEFAULT '[]'::jsonb,
  battery_condition     VARCHAR(40),
  grade                 condition_grade,
  display_name          VARCHAR(300) NOT NULL,
  source                VARCHAR(40) NOT NULL DEFAULT 'manual',
  source_work_order_id  UUID,
  is_current            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_device_config_snapshots_serial
  ON device_configuration_snapshots (serial_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_config_snapshots_current
  ON device_configuration_snapshots (serial_id)
  WHERE is_current = TRUE;

-- ── Installed components ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_component_installations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_id                 UUID NOT NULL REFERENCES serial_numbers(id) ON DELETE CASCADE,
  component_product_id      UUID NOT NULL REFERENCES products(id),
  component_serial_id       UUID REFERENCES serial_numbers(id),
  component_serial_text     VARCHAR(120),
  category                  VARCHAR(40) NOT NULL DEFAULT 'other',
  slot_type                 component_slot_type NOT NULL,
  slot_number               INTEGER NOT NULL DEFAULT 1,
  capacity_gb               INTEGER,
  technology                VARCHAR(60),
  quantity                  INTEGER NOT NULL DEFAULT 1,
  removable                 BOOLEAN NOT NULL DEFAULT TRUE,
  status                    installation_status NOT NULL DEFAULT 'installed',
  installed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  installed_by              UUID REFERENCES users(id),
  removed_at                TIMESTAMPTZ,
  removed_by                UUID REFERENCES users(id),
  cost_at_installation      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  condition                 condition_grade,
  source_stock_move_ref     VARCHAR(80),
  installation_work_order_id UUID,
  removal_work_order_id     UUID,
  version                   INTEGER NOT NULL DEFAULT 1,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_installs_serial
  ON device_component_installations (serial_id);
CREATE INDEX IF NOT EXISTS idx_device_installs_product
  ON device_component_installations (component_product_id);
CREATE INDEX IF NOT EXISTS idx_device_installs_status
  ON device_component_installations (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_installs_active_slot
  ON device_component_installations (serial_id, slot_type, slot_number)
  WHERE status = 'installed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_installs_active_component_serial
  ON device_component_installations (component_serial_id)
  WHERE status = 'installed' AND component_serial_id IS NOT NULL;

-- ── Reconfiguration work orders ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconfiguration_work_orders (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                         VARCHAR(40) NOT NULL UNIQUE,
  serial_id                   UUID NOT NULL REFERENCES serial_numbers(id),
  manufacturer_serial         VARCHAR(100) NOT NULL,
  product_id                  UUID NOT NULL REFERENCES products(id),
  transaction_type            reconfig_transaction_type NOT NULL,
  status                      reconfig_status NOT NULL DEFAULT 'draft',
  reason                      TEXT NOT NULL DEFAULT '',
  warehouse_location          VARCHAR(30) NOT NULL DEFAULT 'warehouse',
  source_location             VARCHAR(30),
  destination_location        VARCHAR(30),
  current_snapshot_id         UUID REFERENCES device_configuration_snapshots(id),
  proposed_snapshot_id        UUID REFERENCES device_configuration_snapshots(id),
  linked_client_id            UUID REFERENCES clients(id),
  linked_quote_id             UUID,
  linked_sale_order_id        UUID REFERENCES sale_orders(id),
  linked_invoice_id           UUID REFERENCES invoices(id),
  linked_repair_id            UUID,
  requested_by                UUID REFERENCES users(id),
  technician_id               UUID REFERENCES users(id),
  approver_id                 UUID REFERENCES users(id),
  qa_officer_id               UUID REFERENCES users(id),
  date_requested              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  date_started                TIMESTAMPTZ,
  date_completed              TIMESTAMPTZ,
  notes                       TEXT,
  cost_before                 NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cost_removed                NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cost_installed              NUMERIC(14, 2) NOT NULL DEFAULT 0,
  labour_cost                 NUMERIC(14, 2) NOT NULL DEFAULT 0,
  other_cost                  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  cost_after                  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  selling_price_before        NUMERIC(14, 2),
  recommended_selling_price   NUMERIC(14, 2),
  final_selling_price         NUMERIC(14, 2),
  price_difference            NUMERIC(14, 2),
  gross_margin                NUMERIC(14, 2),
  gross_margin_pct            NUMERIC(8, 4),
  price_method                VARCHAR(40),
  valuation_event_key         VARCHAR(120) UNIQUE,
  completion_event_key        VARCHAR(120) UNIQUE,
  reverses_work_order_id      UUID REFERENCES reconfiguration_work_orders(id),
  compatibility_override      BOOLEAN NOT NULL DEFAULT FALSE,
  compatibility_override_reason TEXT,
  margin_override             BOOLEAN NOT NULL DEFAULT FALSE,
  version                     INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  UUID REFERENCES users(id),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_rcf_wo_serial ON reconfiguration_work_orders (serial_id);
CREATE INDEX IF NOT EXISTS idx_rcf_wo_status ON reconfiguration_work_orders (status);
CREATE INDEX IF NOT EXISTS idx_rcf_wo_product ON reconfiguration_work_orders (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rcf_wo_active_serial
  ON reconfiguration_work_orders (serial_id)
  WHERE status NOT IN ('completed', 'cancelled', 'reversed');

-- Back-fill FK from snapshots.source_work_order_id (deferred to avoid cycle at create)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_configuration_snapshots_source_wo_fkey'
  ) THEN
    ALTER TABLE device_configuration_snapshots
      ADD CONSTRAINT device_configuration_snapshots_source_wo_fkey
      FOREIGN KEY (source_work_order_id) REFERENCES reconfiguration_work_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_installs_install_wo_fkey'
  ) THEN
    ALTER TABLE device_component_installations
      ADD CONSTRAINT device_installs_install_wo_fkey
      FOREIGN KEY (installation_work_order_id) REFERENCES reconfiguration_work_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_installs_removal_wo_fkey'
  ) THEN
    ALTER TABLE device_component_installations
      ADD CONSTRAINT device_installs_removal_wo_fkey
      FOREIGN KEY (removal_work_order_id) REFERENCES reconfiguration_work_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Removal lines ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconfiguration_removal_lines (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id             UUID NOT NULL REFERENCES reconfiguration_work_orders(id) ON DELETE CASCADE,
  installation_id           UUID NOT NULL REFERENCES device_component_installations(id),
  component_product_id      UUID NOT NULL REFERENCES products(id),
  component_serial_text     VARCHAR(120),
  slot_type                 component_slot_type NOT NULL,
  slot_number               INTEGER NOT NULL DEFAULT 1,
  quantity                  INTEGER NOT NULL DEFAULT 1,
  existing_cost             NUMERIC(14, 2) NOT NULL DEFAULT 0,
  condition_after_removal   condition_grade,
  destination_location      VARCHAR(30) NOT NULL DEFAULT 'pending_testing',
  disposition               component_disposition NOT NULL DEFAULT 'pending_testing',
  data_status               data_status,
  qa_status                 VARCHAR(20) NOT NULL DEFAULT 'pending',
  actual_removed_at         TIMESTAMPTZ,
  removed_by                UUID REFERENCES users(id),
  stock_move_ref            VARCHAR(80),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcf_removal_wo
  ON reconfiguration_removal_lines (work_order_id);

-- ── Installation lines ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconfiguration_installation_lines (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id               UUID NOT NULL REFERENCES reconfiguration_work_orders(id) ON DELETE CASCADE,
  component_product_id        UUID NOT NULL REFERENCES products(id),
  required_spec               JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_serial_id          UUID REFERENCES serial_numbers(id),
  selected_serial_text        VARCHAR(120),
  source_location             VARCHAR(30) NOT NULL DEFAULT 'warehouse',
  quantity                    INTEGER NOT NULL DEFAULT 1,
  unit_cost                   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  target_slot_type            component_slot_type NOT NULL,
  target_slot_number          INTEGER NOT NULL DEFAULT 1,
  reservation_id              VARCHAR(80),
  reservation_status          VARCHAR(20) NOT NULL DEFAULT 'none',
  compatibility_result        VARCHAR(20) NOT NULL DEFAULT 'pending',
  installed_at                TIMESTAMPTZ,
  installed_by                UUID REFERENCES users(id),
  resulting_installation_id   UUID REFERENCES device_component_installations(id),
  stock_move_ref              VARCHAR(80),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcf_install_wo
  ON reconfiguration_installation_lines (work_order_id);

-- ── Approvals ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconfiguration_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID NOT NULL REFERENCES reconfiguration_work_orders(id) ON DELETE CASCADE,
  action          VARCHAR(20) NOT NULL,
  user_id         UUID REFERENCES users(id),
  reason          TEXT,
  margin_override BOOLEAN NOT NULL DEFAULT FALSE,
  compat_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcf_approvals_wo
  ON reconfiguration_approvals (work_order_id);

-- ── QA checks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconfiguration_qa_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID NOT NULL REFERENCES reconfiguration_work_orders(id) ON DELETE CASCADE,
  check_key       VARCHAR(60) NOT NULL,
  label           VARCHAR(200) NOT NULL,
  required        BOOLEAN NOT NULL DEFAULT TRUE,
  result          VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes           TEXT,
  checked_by      UUID REFERENCES users(id),
  checked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (work_order_id, check_key)
);

CREATE INDEX IF NOT EXISTS idx_rcf_qa_wo
  ON reconfiguration_qa_checks (work_order_id);

-- ── Attachments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconfiguration_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID NOT NULL REFERENCES reconfiguration_work_orders(id) ON DELETE CASCADE,
  kind            VARCHAR(40) NOT NULL DEFAULT 'other',
  file_path       TEXT NOT NULL,
  file_name       VARCHAR(255),
  mime_type       VARCHAR(120),
  uploaded_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcf_attachments_wo
  ON reconfiguration_attachments (work_order_id);
