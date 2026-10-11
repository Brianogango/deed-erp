-- Additive, non-destructive. Credit applications for corporate customers:
-- the application (Deed Technologies Credit Application Form), its
-- documents, the credit check and the approval. On approval the customer's
-- credit limit and payment terms are set from the application. Apply BEFORE
-- deploying the release that uses them.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261011_credit_facility_applications_safe.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "credit_facility_applications" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ref"                   VARCHAR(30) NOT NULL UNIQUE,
  "client_id"             UUID NOT NULL,
  "status"                VARCHAR(30) NOT NULL DEFAULT 'draft',
  "requested_limit"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "requested_terms_days"  INTEGER NOT NULL DEFAULT 30,
  "form"                  JSONB NOT NULL DEFAULT '{}',
  "assessment"            JSONB NOT NULL DEFAULT '{}',
  "risk_class"            VARCHAR(10),
  "recommended_limit"     DECIMAL(14,2),
  "recommended_terms_days" INTEGER,
  "approved_limit"        DECIMAL(14,2),
  "approved_terms_days"   INTEGER,
  "conditions"            TEXT,
  "decision_note"         TEXT,
  "paid_transactions"     INTEGER,
  "requested_by"          UUID,
  "recommended_by"        UUID,
  "decided_by"            UUID,
  "decided_at"            TIMESTAMP(3),
  "review_due"            DATE,
  "portal_token"          VARCHAR(80) UNIQUE,
  "portal_expires_at"     TIMESTAMP(3),
  "events"                JSONB NOT NULL DEFAULT '[]',
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_credit_facility_applications_client" ON "credit_facility_applications" ("client_id");
CREATE INDEX IF NOT EXISTS "idx_credit_facility_applications_status" ON "credit_facility_applications" ("status");

CREATE TABLE IF NOT EXISTS "credit_facility_documents" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL REFERENCES "credit_facility_applications"("id") ON DELETE CASCADE,
  "kind"           VARCHAR(40) NOT NULL,
  "name"           VARCHAR(255) NOT NULL,
  "content_type"   VARCHAR(120) NOT NULL,
  "size"           INTEGER NOT NULL,
  "object_key"     VARCHAR(400) NOT NULL,
  "status"         VARCHAR(20) NOT NULL DEFAULT 'received',
  "expires_on"     DATE,
  "note"           TEXT,
  "uploaded_by"    UUID,
  "uploaded_via"   VARCHAR(10) NOT NULL DEFAULT 'staff',
  "reviewed_by"    UUID,
  "reviewed_at"    TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_credit_facility_documents_app" ON "credit_facility_documents" ("application_id");

-- The customer's standing: none (cash / pay on receipt), approved, suspended,
-- revoked, or legacy (credit given before applications existed; asked for
-- the documents at its review date).
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "credit_status" VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "credit_review_due" DATE;

UPDATE "clients"
SET credit_status = 'legacy', credit_review_due = (current_date + interval '3 months')::date
WHERE credit_status = 'none' AND (credit_limit > 0 OR coalesce(payment_terms_days, 0) > 0);

SELECT credit_status, count(*) AS customers FROM "clients" GROUP BY 1 ORDER BY 1;

-- The tables must belong to the app user (see 20261009_new_table_owner_fix.sql).
DO $$ DECLARE o text; t text; BEGIN
  SELECT tableowner INTO o FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices';
  IF o IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['credit_facility_applications', 'credit_facility_documents'] LOOP
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, o);
    END LOOP;
  END IF;
END $$;

COMMIT;
