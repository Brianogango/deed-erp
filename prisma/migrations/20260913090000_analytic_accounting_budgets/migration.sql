CREATE TABLE IF NOT EXISTS "analytic_accounts" (
  "id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytic_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytic_accounts_code_key" UNIQUE ("code")
);

CREATE TABLE IF NOT EXISTS "analytic_budgets" (
  "id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "state" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytic_budgets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_analytic_budget_dates" CHECK ("date_to" >= "date_from"),
  CONSTRAINT "ck_analytic_budget_state" CHECK ("state" IN ('draft','approved','closed'))
);

CREATE TABLE IF NOT EXISTS "analytic_budget_lines" (
  "id" UUID NOT NULL,
  "budget_id" UUID NOT NULL,
  "analytic_account_id" UUID NOT NULL,
  "account_code" VARCHAR(20) NOT NULL,
  "planned_amount" DECIMAL(14,2) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytic_budget_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_analytic_budget_planned_nonnegative" CHECK ("planned_amount" >= 0),
  CONSTRAINT "analytic_budget_lines_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "analytic_budgets"("id") ON DELETE CASCADE,
  CONSTRAINT "analytic_budget_lines_analytic_account_id_fkey" FOREIGN KEY ("analytic_account_id") REFERENCES "analytic_accounts"("id") ON DELETE RESTRICT
);

ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "analytic_account_id" UUID;
DO $$ BEGIN
  ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_analytic_account_id_fkey"
    FOREIGN KEY ("analytic_account_id") REFERENCES "analytic_accounts"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_jel_analytic_account" ON "journal_entry_lines"("analytic_account_id");
CREATE INDEX IF NOT EXISTS "idx_analytic_budgets_period" ON "analytic_budgets"("date_from", "date_to");
CREATE INDEX IF NOT EXISTS "idx_analytic_budget_lines_account" ON "analytic_budget_lines"("analytic_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytic_budget_dimension" ON "analytic_budget_lines"("budget_id", "analytic_account_id", "account_code");
