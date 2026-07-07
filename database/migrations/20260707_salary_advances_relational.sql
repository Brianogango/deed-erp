-- Salary advances relational migration — additive only, safe to re-run.
-- Moves salary advances off the app_state JSON blob into a real table.

CREATE TABLE IF NOT EXISTS salary_advances (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference              VARCHAR(40),
  employee_id            UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  employee_name          VARCHAR(160),
  amount                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_terms          VARCHAR(30) NOT NULL DEFAULT 'payroll_deduction',
  repayment_months       INTEGER NOT NULL DEFAULT 1,
  repayment_start_period VARCHAR(7),
  monthly_deduction      NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_recovered       NUMERIC(12,2) NOT NULL DEFAULT 0,
  outstanding_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions             JSONB NOT NULL DEFAULT '[]',
  reason                 TEXT,
  status                 VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_date         TIMESTAMPTZ NOT NULL DEFAULT now(),
  needed_by_date         DATE,
  approved_by_user_id    UUID,
  approved_by_name       VARCHAR(160),
  decision_date          TIMESTAMPTZ,
  decision_note          TEXT,
  paid_date              DATE,
  created_by_user_id     UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS salary_advances_reference_key ON salary_advances (reference);
CREATE INDEX IF NOT EXISTS idx_salary_advances_employee ON salary_advances (employee_id);
