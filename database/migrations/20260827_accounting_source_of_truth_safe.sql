-- Additive schema for accounting source-of-truth (PR #490) plus Payment columns (PR #491).
-- Applied on Contabo production 2026-08-27 (database deed_erp) as OS user postgres.
-- Do NOT use `prisma db push --accept-data-loss` against production: Prisma's full
-- diff wants to drop app_state, extra user columns, GRN/serial denormalized fields.
--
-- SAFE / NON-DESTRUCTIVE:
--   * ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   * Never DROP, TRUNCATE, or rewrite enums that would remove live values
-- Unique (source_type, source_id, source_version) on journal_entries is best-effort
-- because live journals already have duplicate source keys.
--
-- Enum additions (idempotent).
DO $$ BEGIN
  ALTER TYPE "tax_type" ADD VALUE 'out_of_scope';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "tax_type" ADD VALUE 'non_vat_supplier';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "tax_type" ADD VALUE 'not_selected';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Additive-only schema for PR #490 / #491.
-- Never DROP tables/columns/constraints. Safe to re-run.
BEGIN;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "approval_reason" VARCHAR(500);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "entity_key" VARCHAR(120);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "monetary_hash" VARCHAR(128);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "related_journal_id" UUID;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "request_id" VARCHAR(120);
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "etims_credit_note_number" VARCHAR(100);
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "etims_transmission_status" VARCHAR(30) NOT NULL DEFAULT 'pending';
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMP(3);
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "posted_by_id" UUID;
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "posted_journal_entry_id" UUID;
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "posting_status" VARCHAR(20) NOT NULL DEFAULT 'unposted';
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "tax_point" DATE;
ALTER TABLE "deposit_payments" ADD COLUMN IF NOT EXISTS "bank_account_id" UUID;
ALTER TABLE "deposit_payments" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "deposit_payments" ADD COLUMN IF NOT EXISTS "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES';
ALTER TABLE "deposit_payments" ADD COLUMN IF NOT EXISTS "external_reference" VARCHAR(120);
ALTER TABLE "deposit_payments" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(120);
ALTER TABLE "deposit_payments" ADD COLUMN IF NOT EXISTS "journal_entry_id" UUID;
ALTER TABLE "deposit_payments" ADD COLUMN IF NOT EXISTS "payment_type" VARCHAR(20) NOT NULL DEFAULT 'receipt';
ALTER TABLE "deposits" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "deposits" ADD COLUMN IF NOT EXISTS "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES';
ALTER TABLE "deposits" ADD COLUMN IF NOT EXISTS "posting_status" VARCHAR(20) NOT NULL DEFAULT 'unposted';
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "grn_item_id" UUID;
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "purchase_order_item_id" UUID;
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "tax_category" VARCHAR(30) NOT NULL DEFAULT 'not_selected';
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "tax_claim_eligible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "tax_claim_reason" VARCHAR(255);
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "tax_code" VARCHAR(40);
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "tax_point" DATE;
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "taxable_base" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "document_type" VARCHAR(40) NOT NULL DEFAULT 'customer_invoice';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "etims_control_unit_number" VARCHAR(100);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "etims_invoice_number" VARCHAR(100);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "etims_qr_reference" VARCHAR(255);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "etims_transmission_status" VARCHAR(30) NOT NULL DEFAULT 'not_required';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "etims_transmitted_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "posted_by_id" UUID;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "posted_journal_entry_id" UUID;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "posting_status" VARCHAR(20) NOT NULL DEFAULT 'unposted';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "source_version_hash" VARCHAR(128);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "tax_point" DATE;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "fiscal_year" INTEGER;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "payload_hash" VARCHAR(128);
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "sequence_number" INTEGER;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "source_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "base_currency" VARCHAR(3) NOT NULL DEFAULT 'KES';
ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "rate_date" DATE;
ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "rate_source" VARCHAR(80);
ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "transaction_credit" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "transaction_currency" VARCHAR(3) NOT NULL DEFAULT 'KES';
ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "transaction_debit" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "payment_allocations" ADD COLUMN IF NOT EXISTS "application_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "payment_allocations" ADD COLUMN IF NOT EXISTS "reversal_of_id" UUID;
ALTER TABLE "payment_allocations" ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "amount_base" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bank_account_id" UUID;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES';
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "exchange_rate_to_base" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "external_reference" VARCHAR(120);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(120);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "journal_id" UUID;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "partner_id" UUID;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "payment_type" VARCHAR(30) NOT NULL DEFAULT 'customer_receipt';
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "posting_status" VARCHAR(20) NOT NULL DEFAULT 'unposted';
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "reconciliation_status" VARCHAR(20) NOT NULL DEFAULT 'unreconciled';
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "posted_at" TIMESTAMP(3);
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "posted_by_id" UUID;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "posting_status" VARCHAR(20) NOT NULL DEFAULT 'unposted';
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "statutory_rule_version_id" UUID;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "total_employer_contributions" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "total_housing_levy" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "total_shif" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "housing_levy" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "pension_contribution" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "personal_relief" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "shif" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "amount_base" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "bank_account_id" UUID;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES';
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "exchange_rate_to_base" DECIMAL(18,8) NOT NULL DEFAULT 1;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "external_reference" VARCHAR(120);
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(120);
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "journal_id" UUID;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "partner_id" UUID;
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "payment_type" VARCHAR(30) NOT NULL DEFAULT 'customer_receipt';
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "posting_status" VARCHAR(20) NOT NULL DEFAULT 'unposted';
ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "reconciliation_status" VARCHAR(20) NOT NULL DEFAULT 'unreconciled';
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'open',
    "closed_by_id" UUID,
    "closed_at" TIMESTAMP(3),
    "reopen_requested_by_id" UUID,
    "reopen_approved_by_id" UUID,
    "reopen_reason" VARCHAR(500),
    "reopened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "financial_audit_events" (
    "id" UUID NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_key" VARCHAR(120) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(60),
    "request_id" VARCHAR(120),
    "old_status" VARCHAR(40),
    "new_status" VARCHAR(40),
    "source_version" INTEGER,
    "monetary_hash" VARCHAR(128),
    "related_journal_id" UUID,
    "reason" VARCHAR(500),
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "bank_accounts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "account_number" VARCHAR(80),
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
    "gl_account_id" UUID NOT NULL,
    "journal_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "bank_statements" (
    "id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "statement_ref" VARCHAR(120) NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "opening_balance" DECIMAL(14,2) NOT NULL,
    "closing_balance" DECIMAL(14,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by_id" UUID,
    "reconciled_at" TIMESTAMP(3),
    "reconciled_by_id" UUID,
    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "bank_statement_lines" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "external_id" VARCHAR(160),
    "transaction_date" DATE NOT NULL,
    "value_date" DATE,
    "description" TEXT,
    "reference" VARCHAR(160),
    "amount" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2),
    "reconciliation_status" VARCHAR(20) NOT NULL DEFAULT 'unreconciled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "bank_reconciliation_matches" (
    "id" UUID NOT NULL,
    "statement_line_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "matched_by_id" UUID,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),
    CONSTRAINT "bank_reconciliation_matches_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "expense_records" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(60) NOT NULL,
    "expense_date" DATE NOT NULL,
    "partner_id" UUID,
    "category_code" VARCHAR(60) NOT NULL,
    "description" TEXT NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'KES',
    "amount" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "payment_method" VARCHAR(30),
    "bank_account_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "posting_status" VARCHAR(20) NOT NULL DEFAULT 'unposted',
    "posted_journal_entry_id" UUID,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expense_records_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "tax_transactions" (
    "id" UUID NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" VARCHAR(120) NOT NULL,
    "source_line_id" VARCHAR(120),
    "direction" VARCHAR(10) NOT NULL,
    "tax_category" VARCHAR(30) NOT NULL,
    "tax_rate" DECIMAL(7,4) NOT NULL,
    "taxable_base" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "tax_point" DATE NOT NULL,
    "tax_period" VARCHAR(7) NOT NULL,
    "partner_pin" VARCHAR(30),
    "etims_control_unit_no" VARCHAR(100),
    "etims_invoice_no" VARCHAR(100),
    "transmission_status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "import_entry_no" VARCHAR(100),
    "withholding_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "input_claim_eligible" BOOLEAN NOT NULL DEFAULT true,
    "apportionment_pct" DECIMAL(7,4),
    "original_tax_transaction_id" UUID,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_transactions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "inventory_ledger_entries" (
    "id" UUID NOT NULL,
    "event_key" VARCHAR(160) NOT NULL,
    "product_id" UUID NOT NULL,
    "location" VARCHAR(60) NOT NULL DEFAULT 'warehouse',
    "serial_id" UUID,
    "batch_id" UUID,
    "movement_type" VARCHAR(40) NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "document_date" DATE NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" VARCHAR(120) NOT NULL,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_ledger_entries_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "statutory_rule_versions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "rules" JSONB NOT NULL,
    "source_reference" VARCHAR(255),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "statutory_rule_versions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "payroll_component_lines" (
    "id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "payslip_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "component_code" VARCHAR(60) NOT NULL,
    "component_type" VARCHAR(30) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "employer_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "statutory_rule_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_component_lines_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "deposit_applications" (
    "id" UUID NOT NULL,
    "deposit_id" UUID NOT NULL,
    "invoice_id" UUID,
    "payment_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "application_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'applied',
    "journal_entry_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deposit_applications_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "credit_note_lines" (
    "id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "original_invoice_item_id" UUID,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "taxable_base" DECIMAL(14,2) NOT NULL,
    "tax_category" VARCHAR(30) NOT NULL,
    "tax_rate" DECIMAL(7,4) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "stock_return_required" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "credit_applications" (
    "id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "invoice_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "application_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "fixed_assets" (
    "id" UUID NOT NULL,
    "asset_number" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "asset_class" VARCHAR(80) NOT NULL,
    "acquisition_date" DATE NOT NULL,
    "in_service_date" DATE,
    "acquisition_cost" DECIMAL(14,2) NOT NULL,
    "residual_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "depreciation_method" VARCHAR(30) NOT NULL DEFAULT 'straight_line',
    "accumulated_depreciation" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "carrying_value" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "acquisition_journal_id" UUID,
    "disposal_journal_id" UUID,
    "disposed_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "asset_depreciation_entries" (
    "id" UUID NOT NULL,
    "fixed_asset_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "depreciation_amount" DECIMAL(14,2) NOT NULL,
    "journal_entry_id" UUID,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asset_depreciation_entries_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "financial_reconciliations" (
    "id" UUID NOT NULL,
    "control_type" VARCHAR(50) NOT NULL,
    "period_end" DATE NOT NULL,
    "population_count" INTEGER NOT NULL DEFAULT 0,
    "ledger_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subledger_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "prepared_by_id" UUID,
    "prepared_at" TIMESTAMP(3),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_reconciliations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "accounting_outbox" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "source_type" VARCHAR(60) NOT NULL,
    "source_id" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_outbox_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "_DeliveryNoteSaleOrders" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,
    CONSTRAINT "_DeliveryNoteSaleOrders_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX IF NOT EXISTS "idx_fiscal_period_state" ON "fiscal_periods"("state");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fiscal_period_dates" ON "fiscal_periods"("date_from", "date_to");
CREATE INDEX IF NOT EXISTS "idx_fin_audit_entity" ON "financial_audit_events"("entity_type", "entity_key");
CREATE INDEX IF NOT EXISTS "idx_fin_audit_created" ON "financial_audit_events"("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_account_gl" ON "bank_accounts"("gl_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_statement_ref" ON "bank_statements"("bank_account_id", "statement_ref");
CREATE INDEX IF NOT EXISTS "idx_statement_lines_statement" ON "bank_statement_lines"("statement_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_statement_external_id" ON "bank_statement_lines"("statement_id", "external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bank_recon_match" ON "bank_reconciliation_matches"("statement_line_id", "journal_entry_id");
CREATE UNIQUE INDEX IF NOT EXISTS "expense_records_reference_key" ON "expense_records"("reference");
CREATE INDEX IF NOT EXISTS "idx_expense_record_date" ON "expense_records"("expense_date");
CREATE INDEX IF NOT EXISTS "idx_tax_transaction_period" ON "tax_transactions"("tax_period");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tax_source_line" ON "tax_transactions"("source_type", "source_id", "source_line_id");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_ledger_entries_event_key_key" ON "inventory_ledger_entries"("event_key");
CREATE INDEX IF NOT EXISTS "idx_inventory_ledger_product" ON "inventory_ledger_entries"("product_id", "location", "document_date");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_statutory_rule_effective" ON "statutory_rule_versions"("code", "effective_from");
CREATE INDEX IF NOT EXISTS "idx_payroll_component_run_employee" ON "payroll_component_lines"("payroll_run_id", "employee_id");
CREATE INDEX IF NOT EXISTS "idx_deposit_application_deposit" ON "deposit_applications"("deposit_id");
CREATE INDEX IF NOT EXISTS "idx_deposit_application_invoice" ON "deposit_applications"("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_credit_note_line_note" ON "credit_note_lines"("credit_note_id");
CREATE INDEX IF NOT EXISTS "idx_credit_application_note" ON "credit_applications"("credit_note_id");
CREATE INDEX IF NOT EXISTS "idx_credit_application_invoice" ON "credit_applications"("invoice_id");
CREATE UNIQUE INDEX IF NOT EXISTS "fixed_assets_asset_number_key" ON "fixed_assets"("asset_number");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_asset_depreciation_period" ON "asset_depreciation_entries"("fixed_asset_id", "period");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fin_reconciliation_period" ON "financial_reconciliations"("control_type", "period_end");
CREATE INDEX IF NOT EXISTS "idx_accounting_outbox_pending" ON "accounting_outbox"("status", "available_at");
CREATE INDEX IF NOT EXISTS "_DeliveryNoteSaleOrders_B_index" ON "_DeliveryNoteSaleOrders"("B");
CREATE UNIQUE INDEX IF NOT EXISTS "deposit_payments_idempotency_key_key" ON "deposit_payments"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_payments_partner_date" ON "payments"("partner_id", "paid_at");
CREATE INDEX IF NOT EXISTS "idx_payments_bank_date" ON "payments"("bank_account_id", "paid_at");
CREATE INDEX IF NOT EXISTS "idx_payments_journal" ON "payments"("journal_id");
CREATE INDEX IF NOT EXISTS "idx_payments_posting" ON "payments"("posting_status");
CREATE INDEX IF NOT EXISTS "idx_products_tracking_method" ON "products"("tracking_method");
CREATE INDEX IF NOT EXISTS "idx_sales_inbound_emails_thread" ON "sales_inbound_emails"("provider_thread_id");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payments_idempotency_key_key" ON "supplier_payments"("idempotency_key");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "fiscal_periods",
  "financial_audit_events",
  "bank_accounts",
  "bank_statements",
  "bank_statement_lines",
  "bank_reconciliation_matches",
  "expense_records",
  "tax_transactions",
  "inventory_ledger_entries",
  "statutory_rule_versions",
  "payroll_component_lines",
  "deposit_applications",
  "credit_note_lines",
  "credit_applications",
  "fixed_assets",
  "asset_depreciation_entries",
  "financial_reconciliations",
  "accounting_outbox",
  "_DeliveryNoteSaleOrders"
TO deed_user;
COMMIT;

-- Best-effort unique on existing journals; skip if duplicates already exist.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "uq_journal_source_version"
    ON "journal_entries"("source_type", "source_id", "source_version");
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'skipped uq_journal_source_version because duplicates exist';
END $$;
