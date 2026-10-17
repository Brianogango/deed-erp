-- Additive, non-destructive. A register of cheques received from customers and
-- given to suppliers: the date written on each cheque, where it stands, and a
-- photo of it. Drives the "due tomorrow / ready for banking" reminders.
-- Apply BEFORE deploying the release that reads this table.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -P pager=off -d "$DB" < database/migrations/20261017_cheque_register_safe.sql

CREATE TABLE IF NOT EXISTS "cheques" (
  "id" UUID NOT NULL,
  "direction" VARCHAR(10) NOT NULL,
  "cheque_number" VARCHAR(40) NOT NULL,
  "bank_name" VARCHAR(120) NOT NULL DEFAULT '',
  "party_name" VARCHAR(200) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KES',
  "cheque_date" DATE NOT NULL,
  "received_date" DATE,
  "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
  "linked_type" VARCHAR(30),
  "linked_ref" VARCHAR(80),
  "notes" TEXT,
  "image_key" VARCHAR(300),
  "image_type" VARCHAR(60),
  "history" JSONB NOT NULL DEFAULT '[]',
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cheques_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_cheques_direction" CHECK ("direction" IN ('received','given')),
  CONSTRAINT "ck_cheques_status" CHECK ("status" IN ('pending','deposited','cleared','bounced','cancelled')),
  CONSTRAINT "ck_cheques_amount" CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "cheques_status_date_idx" ON "cheques" ("status", "cheque_date");
CREATE INDEX IF NOT EXISTS "cheques_direction_idx" ON "cheques" ("direction", "cheque_date");
CREATE INDEX IF NOT EXISTS "cheques_number_idx" ON "cheques" ("cheque_number");

-- The table must belong to the app user, or the app and the deploy backup get
-- "permission denied" (see 20261009_new_table_owner_fix.sql).
DO $$ DECLARE o text; BEGIN
  SELECT tableowner INTO o FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices';
  IF o IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', 'cheques', o);
  END IF;
END $$;

SELECT tablename, tableowner FROM pg_tables WHERE tablename IN ('cheques', 'invoices');
SELECT count(*) AS cheques FROM "cheques";
