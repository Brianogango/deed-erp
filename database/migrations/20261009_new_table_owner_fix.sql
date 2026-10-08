-- Fix: the tables created by today's migrations (stock_location_levels,
-- receipt_documents) were created by the postgres user, so the app's own
-- database user could not read or write them ("permission denied for table
-- stock_location_levels"). They are handed to the user that owns the app's
-- other tables, then brought up to date from the screen copies (the
-- mirror into them failed while they were not readable).
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < database/migrations/20261009_new_table_owner_fix.sql

DO $$
DECLARE
  app_owner text;
  t text;
BEGIN
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices';
  IF app_owner IS NULL THEN
    RAISE EXCEPTION 'invoices table not found — is this the app database?';
  END IF;
  FOREACH t IN ARRAY ARRAY['stock_location_levels', 'receipt_documents'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, app_owner);
    END IF;
  END LOOP;
END $$;

-- Catch up with changes made while the app could not write these tables.
INSERT INTO "stock_location_levels" (product_id, location, qty, updated_at)
SELECT r.payload->>'productId', coalesce(nullif(r.payload->>'location', ''), 'warehouse'),
       sum(round(coalesce((r.payload->>'qty')::numeric, 0)))::int, now()
FROM "erp_state_records" r
WHERE r.key = 'deed_bulkStock' AND coalesce(r.payload->>'productId', '') <> ''
GROUP BY 1, 2
ON CONFLICT (product_id, location) DO UPDATE SET qty = EXCLUDED.qty, updated_at = now();

DELETE FROM "stock_location_levels" t
WHERE EXISTS (SELECT 1 FROM "erp_state_records" WHERE key = 'deed_bulkStock')
  AND NOT EXISTS (
    SELECT 1 FROM "erp_state_records" r
    WHERE r.key = 'deed_bulkStock' AND r.payload->>'productId' = t.product_id
      AND coalesce(nullif(r.payload->>'location', ''), 'warehouse') = t.location
  );

INSERT INTO "receipt_documents" (id, ref, po_id, status, receipt_date, record, updated_at)
SELECT DISTINCT ON (r.payload->>'id')
       left(r.payload->>'id', 80), left(r.payload->>'ref', 40), left(r.payload->>'poId', 80),
       left(r.payload->>'status', 20), left(r.payload->>'date', 40), r.payload, now()
FROM "erp_state_records" r
WHERE r.key = 'deed_receipts' AND coalesce(r.payload->>'id', '') <> ''
ORDER BY r.payload->>'id', r.updated_at DESC NULLS LAST
ON CONFLICT (id) DO UPDATE SET ref = EXCLUDED.ref, po_id = EXCLUDED.po_id, status = EXCLUDED.status,
  receipt_date = EXCLUDED.receipt_date, record = EXCLUDED.record, removed_at = NULL, updated_at = now();

SELECT tablename, tableowner = (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices') AS owned_by_app
FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('stock_location_levels', 'receipt_documents');

-- Any other table the app user does not own (should be none):
SELECT tablename, tableowner FROM pg_tables
WHERE schemaname = 'public'
  AND tableowner <> (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices');
