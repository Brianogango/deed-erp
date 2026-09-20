-- Prisma store_records: operational replacement for app_state JSON blobs.
-- Additive and idempotent. Never deletes app_state.

CREATE TABLE IF NOT EXISTS "store_records" (
  "key" VARCHAR(240) NOT NULL,
  "value" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_records_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "idx_store_records_updated_at"
  ON "store_records" ("updated_at");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deed_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE store_records TO deed_user;
  END IF;
END $$;
