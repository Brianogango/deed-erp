-- Leave relational migration — additive only. Safe to run repeatedly.
-- Adds the columns/table needed to make Prisma the source of truth for leave,
-- WITHOUT touching app_state or any other table. (prisma db push is unsafe on
-- this database because several live tables — app_state, ref counters, extra
-- user columns — are managed by raw SQL and are not modelled in schema.prisma.)

-- New columns on leave_requests (all nullable / defaulted → no data loss)
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reference             VARCHAR(40);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS employee_name         VARCHAR(160);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reviewed_by_name      VARCHAR(160);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS submitted_by_user_id  UUID;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS is_system_generated   BOOLEAN NOT NULL DEFAULT false;

-- Unique reference (nullable — many NULLs are allowed under a unique index)
CREATE UNIQUE INDEX IF NOT EXISTS leave_requests_reference_key ON leave_requests (reference);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests (employee_id);

-- Relational leave balances (previously only in the app_state JSON blob)
CREATE TABLE IF NOT EXISTS leave_balances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type    leave_type NOT NULL,
  year          INTEGER NOT NULL,
  entitlement   NUMERIC(5,1) NOT NULL DEFAULT 0,
  carry_forward NUMERIC(5,1) NOT NULL DEFAULT 0,
  used          NUMERIC(5,1) NOT NULL DEFAULT 0,
  pending       NUMERIC(5,1) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_balance_emp_type_year ON leave_balances (employee_id, leave_type, year);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances (employee_id);
