-- Read-only logic health check for the ledger and documents. Writes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/logic-health-check.sql
--
-- Every line is a rule that should hold; "problems" should be 0. A non-zero
-- row names a logic fault to fix (or a one-off to correct).

\echo ''
\echo '== Logic health check =='

WITH
-- A document's own posting entry: JRN/<number> or a numbered copy JRN/<number>/N
-- (bills post as source 'bill', invoices and import copies as 'invoice';
-- delivery charges and payments carry the document id too but are not counted).
live_sales AS (
  SELECT j.invoice_id, count(*) AS n, max(j.total_debit) AS amt
  FROM journal_entries j JOIN invoices i ON i.id = j.invoice_id
  WHERE j.source_type IN ('invoice', 'bill') AND NOT j.is_reversed AND j.reversal_of_id IS NULL
    AND (j.ref = 'JRN/' || i.invoice_number
         OR (left(j.ref, length(i.invoice_number) + 5) = 'JRN/' || i.invoice_number || '/'
             AND substr(j.ref, length(i.invoice_number) + 6) ~ '^[0-9]+$'))
  GROUP BY j.invoice_id
),
live_any AS (
  SELECT invoice_id, count(*) AS n, sum(total_debit) AS amt
  FROM journal_entries
  WHERE source_type IN ('invoice', 'bill') AND NOT is_reversed AND reversal_of_id IS NULL AND invoice_id IS NOT NULL
  GROUP BY invoice_id
),
line_totals AS (
  SELECT j.id, j.ref, round(sum(l.debit), 2) AS dr, round(sum(l.credit), 2) AS cr
  FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
  GROUP BY j.id, j.ref
),
alloc AS (
  SELECT a.invoice_id, sum(a.amount) AS paid
  FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
  WHERE NOT p.is_voided AND a.reversed_at IS NULL
  GROUP BY a.invoice_id
),
screen AS (
  SELECT payload->>'id' AS id, payload->>'ref' AS ref, payload->>'type' AS type, payload->>'status' AS status,
         coalesce((payload->>'total')::numeric, 0) AS total,
         coalesce((payload->>'amountPaid')::numeric, 0) AS paid
  FROM erp_state_records WHERE key = 'deed_invoices'
),
bill_receipts AS (
  SELECT p.id, p.amount
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  JOIN journal_entries j ON (j.payment_id = p.id OR j.id = p.journal_id) AND NOT j.is_reversed AND j.reversal_of_id IS NULL
  WHERE NOT p.is_voided
    AND (i.document_type = 'vendor_bill' OR i.invoice_number LIKE 'BILL%')
    AND EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = j.id AND l.account_label LIKE '1800%' AND l.credit > 0)
    AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = j.id AND l.account_label LIKE '3000%')
  GROUP BY p.id, p.amount
)
SELECT rule, problems, kes FROM (
  SELECT 1 AS o, 'Entries where debits <> credits' AS rule,
         count(*) AS problems, coalesce(sum(abs(dr - cr)), 0) AS kes
  FROM line_totals WHERE dr <> cr
  UNION ALL
  SELECT 2, 'Invoices/bills booked more than once (extra live sales entries)',
         coalesce(sum(n - 1), 0), coalesce(sum((n - 1) * amt), 0)
  FROM live_sales WHERE n > 1
  UNION ALL
  SELECT 3, 'Posted invoices/bills with no live sales entry',
         count(*), coalesce(sum(i.total_amount), 0)
  FROM invoices i LEFT JOIN live_sales s ON s.invoice_id = i.id
  WHERE i.status::text IN ('approved', 'invoiced', 'paid', 'partially_paid')
    AND s.invoice_id IS NULL AND i.invoice_number NOT LIKE 'POS%'
    AND coalesce(i.internal_notes, '') NOT LIKE '%[opening-balance]%'
    AND NOT EXISTS (SELECT 1 FROM journal_entries o WHERE o.invoice_id = i.id AND o.source_type = 'opening_balance' AND NOT o.is_reversed)
  UNION ALL
  SELECT 4, 'Cancelled/voided invoices still booked (live entry)',
         count(*), coalesce(sum(s.amt), 0)
  FROM invoices i JOIN live_any s ON s.invoice_id = i.id
  WHERE i.status::text IN ('cancelled', 'void')
  UNION ALL
  SELECT 5, 'Bill payments booked as customer receipts',
         count(*), coalesce(sum(amount), 0) FROM bill_receipts
  UNION ALL
  SELECT 6, 'Payments with no ledger entry at all',
         count(*), coalesce(sum(amount), 0)
  FROM payments p WHERE NOT p.is_voided
    AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE (j.payment_id = p.id OR j.id = p.journal_id) AND NOT j.is_reversed AND j.reversal_of_id IS NULL)
  UNION ALL
  SELECT 6, '  (info) payments booked but not marked as booked',
         count(*), coalesce(sum(amount), 0)
  FROM payments p WHERE NOT p.is_voided AND (p.posting_status <> 'posted' OR p.journal_id IS NULL)
    AND EXISTS (SELECT 1 FROM journal_entries j WHERE (j.payment_id = p.id OR j.id = p.journal_id) AND NOT j.is_reversed AND j.reversal_of_id IS NULL)
  UNION ALL
  SELECT 7, 'Ledger paid amount below its recorded payments',
         count(*), coalesce(sum(a.paid - i.amount_paid), 0)
  FROM invoices i JOIN alloc a ON a.invoice_id = i.id
  WHERE a.paid > i.amount_paid + 0.01
  UNION ALL
  SELECT 11, 'Paid more than the invoice total',
         count(*), coalesce(sum(amount_paid - total_amount), 0)
  FROM invoices WHERE total_amount > 0 AND amount_paid > total_amount + 0.01
  UNION ALL
  -- Rules 8-10 compared the deed_invoices screen copy with the table. The
  -- screens now read the table and the copy is frozen, so they are gone.
  SELECT 12, 'Documents only in the frozen screen copy (never reached the table)',
         count(*), coalesce(sum(s.total), 0)
  FROM screen s LEFT JOIN invoices i ON i.id::text = s.id
  WHERE i.id IS NULL AND s.status NOT IN ('draft', 'cancelled', 'voided')
) checks
ORDER BY o;
