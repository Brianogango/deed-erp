-- Read-only: every till sale (POS ticket) and where it got to. Writes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/pos-sales-trace.sql
--
-- A till sale should exist in four places:
--   ticket   the till's list (deed_posOrders)
--   invoice  the invoices table (the database)
--   finance  the Finance invoice list (deed_invoices)
--   ledger   its journal entry JRN/POS/NNNN

CREATE TEMP TABLE pos_trace AS
WITH t AS (
  SELECT payload->>'ref' AS ref, payload->>'invoiceId' AS invoice_id,
         (payload->>'total')::numeric AS total, left(payload->>'date', 10) AS date,
         payload->>'createdByName' AS cashier, payload->>'customerName' AS customer
  FROM erp_state_records WHERE key = 'deed_posOrders'
),
s AS (SELECT payload->>'id' AS id, payload->>'ref' AS ref FROM erp_state_records WHERE key = 'deed_invoices')
SELECT t.ref, t.date, t.total, t.cashier, t.customer,
       i.id IS NOT NULL AS in_database,
       i.status::text AS db_status,
       -- Finance lists the invoices table (the screen copy is frozen).
       i.id IS NOT NULL AS in_finance_list,
       EXISTS (SELECT 1 FROM journal_entries j WHERE j.ref = 'JRN/' || t.ref AND NOT j.is_reversed) AS in_ledger
FROM t
LEFT JOIN invoices i ON i.id::text = t.invoice_id OR i.invoice_number = t.ref;

\echo ''
\echo '== Till sales: how many reached each place =='
SELECT count(*) AS tickets,
       count(*) FILTER (WHERE in_database) AS in_database,
       count(*) FILTER (WHERE in_finance_list) AS in_finance_list,
       count(*) FILTER (WHERE in_ledger) AS in_ledger
FROM pos_trace;

\echo ''
\echo '== Till sales missing somewhere =='
SELECT ref, date, total, cashier, customer, in_database, db_status, in_finance_list, in_ledger
FROM pos_trace
WHERE NOT (in_database AND in_finance_list AND in_ledger)
ORDER BY date DESC, ref DESC;

\echo ''
\echo '== POS invoices in the database with no till ticket =='
SELECT i.invoice_number, i.invoice_date, i.total_amount, i.status::text
FROM invoices i
WHERE i.invoice_number LIKE 'POS/%'
  AND NOT EXISTS (SELECT 1 FROM pos_trace p WHERE p.ref = i.invoice_number)
ORDER BY i.invoice_date DESC;
