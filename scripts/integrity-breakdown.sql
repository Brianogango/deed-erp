-- Read-only: why the AR / AP / inventory / VAT integrity controls differ.
-- Splits each gap into the parts that explain it. Writes nothing.
--
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/integrity-breakdown.sql

\echo ''
\echo '== AR (1800) and AP (3000): ledger balance vs open documents =='
WITH gl AS (
  SELECT
    sum(CASE WHEN l.account_label LIKE '1800%' THEN l.debit - l.credit ELSE 0 END) AS ar,
    sum(CASE WHEN l.account_label LIKE '3000%' THEN l.credit - l.debit ELSE 0 END) AS ap
  FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
  WHERE j.is_posted
),
docs AS (
  SELECT i.id, i.document_type, i.invoice_date,
         greatest(i.total_amount - i.amount_paid, 0) AS open_amount,
         EXISTS (SELECT 1 FROM journal_entries j WHERE j.invoice_id = i.id AND NOT j.is_reversed AND j.reversal_of_id IS NULL
                 AND j.source_type IN ('invoice', 'bill', 'opening_balance')) AS in_ledger
  FROM invoices i
  WHERE i.status::text NOT IN ('draft', 'cancelled', 'void') AND i.total_amount > 0
)
SELECT 'AR' AS side,
       (SELECT round(ar, 2) FROM gl) AS ledger_balance,
       round(sum(open_amount) FILTER (WHERE in_ledger), 2) AS open_docs_in_ledger,
       round(sum(open_amount) FILTER (WHERE NOT in_ledger), 2) AS open_docs_never_in_ledger,
       count(*) FILTER (WHERE NOT in_ledger AND open_amount > 0) AS docs_never_in_ledger,
       round(sum(open_amount) FILTER (WHERE NOT in_ledger AND invoice_date < '2026-09-13'), 2) AS of_which_before_13_sep
FROM docs WHERE document_type = 'customer_invoice'
UNION ALL
SELECT 'AP',
       (SELECT round(ap, 2) FROM gl),
       round(sum(open_amount) FILTER (WHERE in_ledger), 2),
       round(sum(open_amount) FILTER (WHERE NOT in_ledger), 2),
       count(*) FILTER (WHERE NOT in_ledger AND open_amount > 0),
       round(sum(open_amount) FILTER (WHERE NOT in_ledger AND invoice_date < '2026-09-13'), 2)
FROM docs WHERE document_type = 'vendor_bill';

\echo ''
\echo '== AR / AP entries not tied to any document (manual, opening, payments) =='
SELECT CASE WHEN l.account_label LIKE '1800%' THEN 'AR' ELSE 'AP' END AS side,
       j.source_type, count(DISTINCT j.id) AS entries,
       round(sum(CASE WHEN l.account_label LIKE '1800%' THEN l.debit - l.credit ELSE l.credit - l.debit END), 2) AS net
FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
WHERE j.is_posted AND (l.account_label LIKE '1800%' OR l.account_label LIKE '3000%')
GROUP BY 1, 2 ORDER BY 1, 4 DESC;

\echo ''
\echo '== Inventory: ledger 1200 vs stock valuation =='
SELECT
  (SELECT round(sum(l.debit - l.credit), 2) FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
    WHERE j.is_posted AND l.account_label LIKE '1200%') AS ledger_1200,
  (SELECT round(sum(total_value), 2) FROM product_valuations) AS stock_valuation,
  (SELECT count(*) FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
    WHERE j.is_posted AND l.account_label LIKE '1200%' AND j.source_type = 'opening_balance') AS opening_stock_entries;

\echo ''
\echo '== Inventory entries by kind =='
SELECT j.source_type, count(DISTINCT j.id) AS entries, round(sum(l.debit - l.credit), 2) AS net_1200
FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
WHERE j.is_posted AND l.account_label LIKE '1200%'
GROUP BY 1 ORDER BY 3 DESC;

\echo ''
\echo '== VAT: invoices with VAT in the ledger but no tax records =='
SELECT i.document_type, count(*) AS docs, round(sum(i.tax_amount), 2) AS vat
FROM invoices i
WHERE i.tax_amount > 0 AND i.status::text NOT IN ('draft', 'cancelled', 'void')
  AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.invoice_id = i.id AND NOT j.is_reversed AND j.reversal_of_id IS NULL AND j.source_type IN ('invoice', 'bill'))
  AND NOT EXISTS (SELECT 1 FROM tax_transactions t WHERE t.source_id = i.id::text)
GROUP BY 1;

\echo ''
\echo '== Customer deposits account (3100) entries =='
SELECT j.ref, j.entry_date, j.source_type, l.debit, l.credit
FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
WHERE j.is_posted AND l.account_label LIKE '3100%'
ORDER BY j.entry_date DESC LIMIT 10;
