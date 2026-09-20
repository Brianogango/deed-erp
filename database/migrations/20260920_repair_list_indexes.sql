-- Repair list pagination orders newest-first and technicians are scoped
-- to their assigned work. Both indexes are safe to apply repeatedly.

CREATE INDEX IF NOT EXISTS idx_repairs_intake_job
  ON repairs (intake_date, job_number);

CREATE INDEX IF NOT EXISTS idx_repairs_assignee_intake
  ON repairs (assigned_to, intake_date);
