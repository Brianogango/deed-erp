-- Additive, non-destructive. Inventory stage 2: goods receipts as the
-- screens use them (drafts included) get their own table, receipt_documents,
-- filled from the deed_receipts copy. goods_received_notes stays the record
-- of what a validated receipt put into stock. Apply BEFORE deploying the
-- release that reads receipts from the database.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261009_receipt_documents_safe.sql

CREATE TABLE IF NOT EXISTS "receipt_documents" (
  "id"            VARCHAR(80) PRIMARY KEY,
  "ref"           VARCHAR(40),
  "po_id"         VARCHAR(80),
  "status"        VARCHAR(20),
  "receipt_date"  VARCHAR(40),
  "record"        JSONB NOT NULL,
  "removed_at"    TIMESTAMP(3),
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_receipt_documents_po" ON "receipt_documents" ("po_id");

INSERT INTO "receipt_documents" (id, ref, po_id, status, receipt_date, record, updated_at)
SELECT DISTINCT ON (r.payload->>'id')
       left(r.payload->>'id', 80), left(r.payload->>'ref', 40), left(r.payload->>'poId', 80),
       left(r.payload->>'status', 20), left(r.payload->>'date', 40), r.payload, now()
FROM "erp_state_records" r
WHERE r.key = 'deed_receipts' AND coalesce(r.payload->>'id', '') <> ''
ORDER BY r.payload->>'id', r.updated_at DESC NULLS LAST
ON CONFLICT (id) DO UPDATE SET ref = EXCLUDED.ref, po_id = EXCLUDED.po_id, status = EXCLUDED.status,
  receipt_date = EXCLUDED.receipt_date, record = EXCLUDED.record, removed_at = NULL, updated_at = now();

SELECT (SELECT count(*) FROM "erp_state_records" WHERE key = 'deed_receipts') AS receipts_in_copy,
       (SELECT count(*) FROM "receipt_documents" WHERE removed_at IS NULL) AS receipts_in_table,
       (SELECT count(*) FROM "receipt_documents" WHERE status = 'validated') AS validated,
       (SELECT count(*) FROM "goods_received_notes") AS stock_records;

-- The table must belong to the app user (see 20261009_new_table_owner_fix.sql).
DO $$ DECLARE o text; BEGIN SELECT tableowner INTO o FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices'; IF o IS NOT NULL THEN EXECUTE format('ALTER TABLE public.%I OWNER TO %I', 'receipt_documents', o); END IF; END $$;
