-- Payroll relational migration — additive only, safe to re-run.
-- Adds the columns needed to round-trip the client PayrollRun/Payslip shapes
-- through the existing payroll_runs / payslips tables.

ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_month     VARCHAR(20);
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_year      INTEGER;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS posted_journal_id UUID;

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS reference          VARCHAR(40);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS employee_name      VARCHAR(160);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS advance_deductions JSONB NOT NULL DEFAULT '[]';
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS status             VARCHAR(20) NOT NULL DEFAULT 'draft';
