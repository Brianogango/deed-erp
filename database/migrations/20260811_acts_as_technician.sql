-- Opt-in technician capability for non-technician roles (e.g. a chosen Kilimall officer).
ALTER TABLE users ADD COLUMN IF NOT EXISTS acts_as_technician BOOLEAN NOT NULL DEFAULT false;
