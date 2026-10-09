-- Additive, non-destructive: new nullable columns and two new tables. Old code ignores them.
-- Apply BEFORE deploying the release that reads or writes them.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "work_email" VARCHAR(150);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "housing_allowance" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "transport_allowance" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "probation_end_date" DATE;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "exit_reason" VARCHAR(60);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "exit_notes" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "onboarding_checklist" JSONB;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "exit_checklist" JSONB;

CREATE TABLE IF NOT EXISTS "employee_disciplinary_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "record_type" VARCHAR(30) NOT NULL,
  "incident_date" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "action_taken" TEXT,
  "issued_by_name" VARCHAR(160),
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_disciplinary_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_disciplinary_records_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_disciplinary_employee" ON "employee_disciplinary_records"("employee_id");

CREATE TABLE IF NOT EXISTS "public_holidays" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "holiday_date" DATE NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "public_holidays_holiday_date_key" ON "public_holidays"("holiday_date");
