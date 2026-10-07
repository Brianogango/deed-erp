-- Read-only: where the AR, AP and inventory differences come from. Writes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/integrity-drilldown.sql

\echo ''
\echo '== 1. Opening balances: what the 13 Sep opening entries put on each account =='
SELECT l.account_label, count(DISTINCT j.id) AS entries,
       round(sum(l.debit), 2) AS debit, round(sum(l.credit), 2) AS credit
FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
WHERE j.is_posted AND j.source_type = 'opening_balance'
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '== 2. Customer receipts (AR credits) by the invoice they paid =='
WITH pay AS (
  SELECT j.id, j.invoice_id, sum(l.credit - l.debit) AS ar_credit
  FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
  WHERE j.is_posted AND j.source_type = 'payment' AND l.account_label LIKE '1800%'
  GROUP BY j.id, j.invoice_id
)
SELECT CASE
         WHEN p.invoice_id IS NULL THEN 'no invoice linked'
         WHEN EXISTS (SELECT 1 FROM journal_entries s WHERE s.invoice_id = p.invoice_id AND s.source_type IN ('invoice', 'bill', 'opening_balance')
                      AND NOT s.is_reversed AND s.reversal_of_id IS NULL) THEN 'invoice is in the ledger'
         WHEN coalesce(i.internal_notes, '') LIKE '%[opening-balance]%' THEN 'opening-balance invoice, no entry'
         WHEN i.invoice_date < '2026-09-13' THEN 'invoice before 13 Sep, never in the ledger'
         ELSE 'invoice since 13 Sep, never in the ledger'
       END AS paid_invoice,
       count(*) AS receipts, round(sum(p.ar_credit), 2) AS ar_credited
FROM pay p LEFT JOIN invoices i ON i.id = p.invoice_id
GROUP BY 1 ORDER BY 3 DESC;

\echo ''
\echo '== 3. Manual entries touching AR (1800) or AP (3000), largest first =='
SELECT j.ref, j.entry_date, left(coalesce(j.description, ''), 60) AS description,
       round(sum(CASE WHEN l.account_label LIKE '1800%' THEN l.debit - l.credit ELSE 0 END), 2) AS ar_net,
       round(sum(CASE WHEN l.account_label LIKE '3000%' THEN l.credit - l.debit ELSE 0 END), 2) AS ap_net
FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
WHERE j.is_posted AND j.source_type = 'manual' AND (l.account_label LIKE '1800%' OR l.account_label LIKE '3000%')
GROUP BY j.id, j.ref, j.entry_date, j.description
ORDER BY abs(sum(CASE WHEN l.account_label LIKE '1800%' THEN l.debit - l.credit ELSE 0 END))
       + abs(sum(CASE WHEN l.account_label LIKE '3000%' THEN l.credit - l.debit ELSE 0 END)) DESC
LIMIT 25;

\echo ''
\echo '== 4. Bills: ledger AP per bill vs what the bill says is still owed (biggest gaps) =='
WITH ap AS (
  SELECT j.invoice_id, sum(l.credit - l.debit) AS ledger_owed
  FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
  WHERE j.is_posted AND j.invoice_id IS NOT NULL AND l.account_label LIKE '3000%'
  GROUP BY j.invoice_id
)
SELECT i.invoice_number, i.invoice_date, i.status::text AS status, i.total_amount, i.amount_paid,
       round(greatest(i.total_amount - i.amount_paid, 0), 2) AS doc_owed, round(ap.ledger_owed, 2) AS ledger_owed,
       round(ap.ledger_owed - greatest(i.total_amount - i.amount_paid, 0), 2) AS diff
FROM ap JOIN invoices i ON i.id = ap.invoice_id
WHERE abs(ap.ledger_owed - greatest(i.total_amount - i.amount_paid, 0)) > 1
ORDER BY abs(ap.ledger_owed - greatest(i.total_amount - i.amount_paid, 0)) DESC
LIMIT 25;

\echo ''
\echo '== 5. Supplier payments (purchase_payment) not linked to a bill =='
SELECT count(DISTINCT j.id) AS entries, round(sum(l.debit - l.credit), 2) AS ap_debited
FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
WHERE j.is_posted AND j.source_type = 'purchase_payment' AND l.account_label LIKE '3000%' AND j.invoice_id IS NULL;

\echo ''
\echo '== 6. Invoices: ledger AR per invoice vs what the invoice says is still owed (biggest gaps) =='
WITH ar AS (
  SELECT j.invoice_id, sum(l.debit - l.credit) AS ledger_owed
  FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
  WHERE j.is_posted AND j.invoice_id IS NOT NULL AND l.account_label LIKE '1800%'
  GROUP BY j.invoice_id
)
SELECT i.invoice_number, i.invoice_date, i.status::text AS status, i.total_amount, i.amount_paid,
       round(greatest(i.total_amount - i.amount_paid, 0), 2) AS doc_owed, round(ar.ledger_owed, 2) AS ledger_owed,
       round(ar.ledger_owed - greatest(i.total_amount - i.amount_paid, 0), 2) AS diff
FROM ar JOIN invoices i ON i.id = ar.invoice_id
WHERE abs(ar.ledger_owed - greatest(i.total_amount - i.amount_paid, 0)) > 1
ORDER BY abs(ar.ledger_owed - greatest(i.total_amount - i.amount_paid, 0)) DESC
LIMIT 25;

\echo ''
\echo '== 7. Inventory (1200) movements before and since 13 Sep =='
SELECT CASE WHEN j.entry_date < '2026-09-13' THEN 'before 13 Sep' ELSE 'since 13 Sep' END AS period,
       j.source_type, count(DISTINCT j.id) AS entries, round(sum(l.debit - l.credit), 2) AS net_1200
FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
WHERE j.is_posted AND l.account_label LIKE '1200%'
GROUP BY 1, 2 ORDER BY 1, 4 DESC;

\echo ''
\echo '== 8. Stock valuation: units and value on hand =='
SELECT count(*) FILTER (WHERE total_qty > 0) AS products_in_stock, sum(total_qty) AS units,
       round(sum(total_value), 2) AS value,
       count(*) FILTER (WHERE total_qty <= 0 AND total_value <> 0) AS products_with_value_but_no_units,
       round(sum(total_value) FILTER (WHERE total_qty <= 0), 2) AS value_with_no_units
FROM product_valuations;
