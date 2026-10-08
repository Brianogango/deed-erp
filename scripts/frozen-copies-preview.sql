-- Read-only. For each frozen screen copy: how many rows it holds and how many
-- of those its table does NOT have. A copy can be retired (scripts/
-- retire-frozen-copies.sql) only when that number is 0 — otherwise those rows
-- still show on the screens from the copy and would disappear. Changes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/frozen-copies-preview.sql

CREATE OR REPLACE FUNCTION pg_temp.in_table(k text, p jsonb) RETURNS boolean AS $$
  SELECT CASE k
    WHEN 'deed_invoices' THEN EXISTS (SELECT 1 FROM invoices t WHERE t.id::text = p->>'id' OR t.invoice_number = p->>'ref')
    WHEN 'deed_saleOrders' THEN EXISTS (SELECT 1 FROM sale_orders t WHERE t.id::text = p->>'id' OR t.order_number = p->>'ref')
    WHEN 'deed_quotes' THEN EXISTS (SELECT 1 FROM quotes t WHERE t.id::text = p->>'id' OR t.quote_number = p->>'ref')
    -- A journal whose lines carry no money (browser leftovers such as
    -- JRN/POS/0083) has nothing the ledger needs.
    WHEN 'deed_journalEntries' THEN EXISTS (SELECT 1 FROM journal_entries t WHERE t.id::text = p->>'id' OR t.blob_id = p->>'id' OR t.ref = p->>'ref')
      OR coalesce((SELECT sum(abs(coalesce((l->>'debit')::numeric, 0)) + abs(coalesce((l->>'credit')::numeric, 0)))
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'lines') = 'array' THEN p->'lines' ELSE '[]'::jsonb END) l), 0) = 0
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

SELECT r.key AS copy,
       count(*) AS rows_in_copy,
       count(*) FILTER (WHERE NOT pg_temp.in_table(r.key, r.payload)) AS only_in_copy,
       max(r.updated_at)::date AS last_written,
       CASE WHEN count(*) FILTER (WHERE NOT pg_temp.in_table(r.key, r.payload)) = 0 THEN 'ready' ELSE 'keep' END AS retire
FROM erp_state_records r
WHERE r.key IN ('deed_invoices', 'deed_saleOrders', 'deed_quotes', 'deed_journalEntries', 'deed_accounts', 'deed_contacts', 'deed_purchaseOrders', 'deed_deposits', 'deed_deposits_v1', 'deed_holdovers', 'deed_repairs_v2', 'deed_auditLogs', 'deed_oppActivities', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_receipts')
GROUP BY r.key
ORDER BY r.key;

\echo 'Samples of rows only in a copy (first 3 per copy)'
SELECT key, left(payload::text, 160) AS row
FROM (
  SELECT r.key, r.payload, row_number() OVER (PARTITION BY r.key ORDER BY r.updated_at DESC) AS n
  FROM erp_state_records r
  WHERE r.key IN ('deed_invoices', 'deed_saleOrders', 'deed_quotes', 'deed_journalEntries', 'deed_accounts', 'deed_contacts', 'deed_purchaseOrders', 'deed_deposits', 'deed_deposits_v1', 'deed_holdovers', 'deed_repairs_v2', 'deed_auditLogs', 'deed_oppActivities', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves', 'deed_receipts') AND NOT pg_temp.in_table(r.key, r.payload)
) x
WHERE n <= 3
ORDER BY key;
