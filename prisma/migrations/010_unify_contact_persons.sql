-- Unify "contact person" and "linked individual" into one concept.
--
-- Two screens were reading two different stores under the same label. The
-- company edit form wrote contact_persons; the contact detail panel filtered
-- clients by an employer link. Worse, the clients table had no column for that
-- link at all, so the panel could only ever show zero.
--
-- This migration gives clients the two columns the app's Contact type has
-- always carried (company_id, job_title) and moves every contact_persons row
-- into clients as an individual contact.
--
-- IDS ARE PRESERVED. opportunities.contact_person_id and
-- customer_contracts.contact_person_id point at contact_persons ids; copying
-- each row into clients under the same id keeps every one of those links
-- resolving instead of silently going blank.
--
-- Re-runnable: the insert skips ids that already exist.
--
-- Rollback:
--   -- contact_persons is left intact by this script, so reverting is:
--   DELETE FROM clients WHERE id IN (SELECT id FROM contact_persons);
--   ALTER TABLE clients DROP COLUMN IF EXISTS company_id,
--                       DROP COLUMN IF EXISTS job_title;

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS company_id UUID,
  ADD COLUMN IF NOT EXISTS job_title  VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_company_id_fkey'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES clients(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_company ON clients (company_id);

-- Move contact persons in. client_number is NOT NULL and unique, so each new
-- row gets a generated one that cannot collide with the CLI/xxxx series.
INSERT INTO clients (
  id, client_number, name, client_type, company_id, job_title,
  email, phone, phone_alt, notes, is_customer, is_vendor,
  credit_limit, credit_balance, loyalty_points, is_active,
  country, created_at, updated_at
)
SELECT
  cp.id,
  'CP/' || substr(replace(cp.id::text, '-', ''), 1, 16),
  NULLIF(btrim(coalesce(cp.first_name, '') || ' ' || coalesce(cp.last_name, '')), ''),
  'individual',
  cp.client_id,
  cp.position,
  cp.email,
  cp.phone,
  cp.mobile,
  cp.notes,
  TRUE,
  FALSE,
  0, 0, 0, TRUE,
  'Kenya',
  cp.created_at,
  cp.updated_at
FROM contact_persons cp
WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = cp.id)
  -- A row with no name at all cannot become a contact; leave it behind
  -- rather than creating a nameless directory entry.
  AND NULLIF(btrim(coalesce(cp.first_name, '') || ' ' || coalesce(cp.last_name, '')), '') IS NOT NULL
  -- The employer must exist, or the foreign key would reject the row.
  AND EXISTS (SELECT 1 FROM clients c WHERE c.id = cp.client_id);

COMMIT;

-- Verify (expects the second count to be 0 once migrated):
--   SELECT count(*) FROM clients WHERE company_id IS NOT NULL;
--   SELECT count(*) FROM contact_persons cp
--     WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = cp.id);
--
-- contact_persons is deliberately NOT dropped here. Keep it until the app has
-- run on the unified model long enough to be trusted, then retire it.
