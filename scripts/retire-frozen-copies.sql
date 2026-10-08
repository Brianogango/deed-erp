-- Retire frozen screen copies: each copy whose table holds every one of its
-- rows (only_in_copy = 0 in scripts/frozen-copies-preview.sql) is moved to
-- the retired_screen_copies archive table and removed from the live store.
-- Copies that still hold rows their table lacks are left untouched and
-- listed. Nothing is lost: scripts/restore-frozen-copy.sql puts a copy back.
-- Run only after the agreed waiting period.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" < scripts/retire-frozen-copies.sql

CREATE OR REPLACE FUNCTION pg_temp.in_table(k text, p jsonb) RETURNS boolean AS $$
  SELECT CASE k
    WHEN 'deed_invoices' THEN EXISTS (SELECT 1 FROM invoices t WHERE t.id::text = p->>'id' OR t.invoice_number = p->>'ref')
    WHEN 'deed_saleOrders' THEN EXISTS (SELECT 1 FROM sale_orders t WHERE t.id::text = p->>'id' OR t.order_number = p->>'ref')
    WHEN 'deed_quotes' THEN EXISTS (SELECT 1 FROM quotes t WHERE t.id::text = p->>'id' OR t.quote_number = p->>'ref')
    WHEN 'deed_journalEntries' THEN EXISTS (SELECT 1 FROM journal_entries t WHERE t.id::text = p->>'id' OR t.blob_id = p->>'id' OR t.ref = p->>'ref')
    WHEN 'deed_accounts' THEN EXISTS (SELECT 1 FROM account_codes t WHERE t.code = p->>'code')
    WHEN 'deed_contacts' THEN EXISTS (SELECT 1 FROM clients t WHERE t.id::text = p->>'id')
    WHEN 'deed_purchaseOrders' THEN EXISTS (SELECT 1 FROM purchase_orders t WHERE t.id::text = p->>'id' OR t.po_number = p->>'ref')
    WHEN 'deed_deposits' THEN EXISTS (SELECT 1 FROM deposits t WHERE t.id::text = p->>'id' OR t.blob_id = p->>'id' OR t.ref = p->>'ref')
    WHEN 'deed_deposits_v1' THEN EXISTS (SELECT 1 FROM deposits t WHERE t.id::text = p->>'id' OR t.blob_id = p->>'id' OR t.ref = p->>'ref')
    WHEN 'deed_holdovers' THEN EXISTS (SELECT 1 FROM holdovers t WHERE t.id::text = p->>'id' OR t.blob_id = p->>'id' OR t.ref = p->>'ref')
    WHEN 'deed_repairs_v2' THEN EXISTS (SELECT 1 FROM repairs t WHERE t.id::text = p->>'id' OR t.job_number = p->>'ref')
    WHEN 'deed_auditLogs' THEN EXISTS (SELECT 1 FROM audit_logs t WHERE t.entity_type = 'document' AND t.new_values->>'copyId' = p->>'id')
    WHEN 'deed_oppActivities' THEN EXISTS (SELECT 1 FROM opportunity_activities t WHERE t.id::text = p->>'id')
    WHEN 'deed_serials' THEN EXISTS (SELECT 1 FROM serial_numbers t WHERE t.serial_number = p->>'serial')
    WHEN 'deed_bulkStock' THEN EXISTS (SELECT 1 FROM stock_location_levels t WHERE t.product_id = p->>'productId' AND t.location = coalesce(nullif(p->>'location', ''), 'warehouse'))
    WHEN 'deed_stockMoves' THEN EXISTS (SELECT 1 FROM stock_movements t WHERE t.blob_id = p->>'id')
    WHEN 'deed_receipts' THEN EXISTS (SELECT 1 FROM receipt_documents t WHERE t.id = p->>'id')
    ELSE false END
$$ LANGUAGE sql;

CREATE TABLE IF NOT EXISTS retired_screen_copies (
  key         VARCHAR(160) NOT NULL,
  record_key  VARCHAR(240) NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMP(3),
  updated_at  TIMESTAMP(3),
  retired_at  TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retired_screen_copies_key ON retired_screen_copies (key);

DO $$
DECLARE o text;
BEGIN
  SELECT tableowner INTO o FROM pg_tables WHERE schemaname = 'public' AND tablename = 'invoices';
  IF o IS NOT NULL THEN EXECUTE format('ALTER TABLE public.retired_screen_copies OWNER TO %I', o); END IF;
END $$;

BEGIN;

CREATE TEMP TABLE retire_keys ON COMMIT DROP AS
SELECT r.key
FROM erp_state_records r
WHERE r.key IN ('deed_invoices', 'deed_saleOrders', 'deed_quotes', 'deed_journalEntries', 'deed_accounts', 'deed_contacts', 'deed_purchaseOrders', 'deed_deposits', 'deed_deposits_v1', 'deed_holdovers', 'deed_repairs_v2', 'deed_auditLogs', 'deed_oppActivities', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_receipts')
GROUP BY r.key
HAVING count(*) FILTER (WHERE NOT pg_temp.in_table(r.key, r.payload)) = 0;

INSERT INTO retired_screen_copies (key, record_key, position, payload, created_at, updated_at)
SELECT r.key, r.record_key, r.position, r.payload, r.created_at, r.updated_at
FROM erp_state_records r
WHERE r.key IN (SELECT key FROM retire_keys);

-- The old single-row store (app_state) may still hold a copy of the same key.
INSERT INTO retired_screen_copies (key, record_key, position, payload, created_at, updated_at)
SELECT a.key, 'app_state', 0, to_jsonb(a.value), NULL, NULLIF(a.updated_at::text, '')::timestamp
FROM app_state a
WHERE a.key IN (SELECT key FROM retire_keys);

DELETE FROM erp_state_records WHERE key IN (SELECT key FROM retire_keys);
DELETE FROM erp_state_keys WHERE key IN (SELECT key FROM retire_keys);
DELETE FROM app_state WHERE key IN (SELECT key FROM retire_keys);

SELECT key AS retired FROM retire_keys ORDER BY 1;

COMMIT;

\echo 'Kept (still hold rows their table lacks) — see scripts/frozen-copies-preview.sql'
SELECT r.key AS kept, count(*) FILTER (WHERE NOT pg_temp.in_table(r.key, r.payload)) AS only_in_copy
FROM erp_state_records r
WHERE r.key IN ('deed_invoices', 'deed_saleOrders', 'deed_quotes', 'deed_journalEntries', 'deed_accounts', 'deed_contacts', 'deed_purchaseOrders', 'deed_deposits', 'deed_deposits_v1', 'deed_holdovers', 'deed_repairs_v2', 'deed_auditLogs', 'deed_oppActivities', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_receipts')
GROUP BY r.key
ORDER BY 1;
