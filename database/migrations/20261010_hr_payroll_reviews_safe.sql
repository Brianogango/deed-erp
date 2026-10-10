-- Additive, non-destructive: one nullable column and new tables. Old code ignores them.
-- Apply BEFORE deploying the release that reads or writes them.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "manager_id" UUID;

CREATE TABLE IF NOT EXISTS "payroll_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "period_year" INTEGER NOT NULL,
  "period_month" INTEGER NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
  "applied_run_id" UUID,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_payroll_adjustments_period" ON "payroll_adjustments"("period_year", "period_month", "status");
CREATE INDEX IF NOT EXISTS "idx_payroll_adjustments_employee" ON "payroll_adjustments"("employee_id");

CREATE TABLE IF NOT EXISTS "policy_acknowledgements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "policy_id" VARCHAR(80) NOT NULL,
  "policy_title" VARCHAR(200) NOT NULL,
  "policy_version" VARCHAR(40) NOT NULL,
  "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policy_acknowledgements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "policy_acknowledgements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_policy_ack" ON "policy_acknowledgements"("employee_id", "policy_id", "policy_version");

CREATE TABLE IF NOT EXISTS "appraisal_cycles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(120) NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'open',
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "appraisal_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "appraisals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cycle_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "reviewer_name" VARCHAR(160),
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending_self',
  "goals" JSONB NOT NULL DEFAULT '[]',
  "self_comments" TEXT,
  "manager_comments" TEXT,
  "strengths" TEXT,
  "improvements" TEXT,
  "self_rating" INTEGER,
  "manager_rating" INTEGER,
  "final_rating" INTEGER,
  "employee_ack_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "appraisals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appraisals_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "appraisal_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "appraisals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_appraisal_cycle_employee" ON "appraisals"("cycle_id", "employee_id");
