-- Read-only: the records behind each non-zero line of logic-health-check.sql.
--
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/logic-health-details.sql

\echo ''
\echo '== 3. Posted documents with no live sales entry — by kind =='
SELECT i.document_type AS kind, i.status::text AS status, i.posting_status,
       EXISTS (SELECT 1 FROM journal_entries j WHERE j.invoice_id = i.id AND j.source_type = 'invoice') AS had_an_entry,
       to_char(i.invoice_date, 'YYYY-MM') AS month, count(*) AS docs, sum(i.total_amount) AS kes
FROM invoices i
WHERE i.status::text IN ('approved', 'invoiced', 'paid', 'partially_paid') AND i.invoice_date >= '2026-09-13'
  AND i.invoice_number NOT LIKE 'POS%'
  AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.invoice_id = i.id AND j.source_type = 'invoice' AND NOT j.is_reversed AND j.reversal_of_id IS NULL)
GROUP BY 1, 2, 3, 4, 5 ORDER BY 7 DESC;

\echo ''
\echo '== 3. Largest ten =='
SELECT i.invoice_number, left(c.name, 24) AS partner, i.total_amount, i.invoice_date::date, i.posting_status,
       (SELECT string_agg(j.ref || CASE WHEN j.is_reversed THEN ' (reversed)' ELSE '' END, ', ')
          FROM journal_entries j WHERE j.invoice_id = i.id AND j.source_type = 'invoice') AS entries
FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
WHERE i.status::text IN ('approved', 'invoiced', 'paid', 'partially_paid') AND i.invoice_date >= '2026-09-13'
  AND i.invoice_number NOT LIKE 'POS%'
  AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.invoice_id = i.id AND j.source_type = 'invoice' AND NOT j.is_reversed AND j.reversal_of_id IS NULL)
ORDER BY i.total_amount DESC LIMIT 10;

\echo ''
\echo '== 4. Cancelled invoices still booked =='
SELECT i.invoice_number, i.status::text, i.total_amount, j.ref, j.created_at::timestamp(0)
FROM invoices i JOIN journal_entries j ON j.invoice_id = i.id
WHERE i.status::text IN ('cancelled', 'void') AND j.source_type = 'invoice' AND NOT j.is_reversed AND j.reversal_of_id IS NULL;

\echo ''
\echo '== 6. Payments with no ledger entry — by kind =='
SELECT p.payment_type, p.payment_method::text AS method, substring(p.notes from 'method:([a-z_]+)') AS raw_method,
       coalesce(i.document_type, '(no invoice)') AS on_doc, p.bank_account_id IS NOT NULL AS bank_set,
       to_char(p.paid_at, 'YYYY-MM') AS month, count(*) AS payments, sum(p.amount) AS kes
FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
WHERE NOT p.is_voided AND (p.posting_status <> 'posted' OR p.journal_id IS NULL)
GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 8 DESC;

\echo ''
\echo '== 6. Ten examples =='
SELECT i.invoice_number, p.amount, p.payment_method::text, p.paid_at::date, p.created_at::timestamp(0), p.posting_status,
       EXISTS (SELECT 1 FROM journal_entries j WHERE j.payment_id = p.id) AS has_any_entry
FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
WHERE NOT p.is_voided AND (p.posting_status <> 'posted' OR p.journal_id IS NULL)
ORDER BY p.created_at DESC LIMIT 10;

\echo ''
\echo '== 9. Screen and ledger disagree on amount paid =='
SELECT s.payload->>'ref' AS doc, s.payload->>'type' AS kind, (s.payload->>'total')::numeric AS total,
       coalesce((s.payload->>'amountPaid')::numeric, 0) AS screen_paid, i.amount_paid AS ledger_paid,
       (SELECT coalesce(sum(a.amount), 0) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
         WHERE a.invoice_id = i.id AND NOT p.is_voided AND a.reversed_at IS NULL) AS recorded_payments
FROM erp_state_records s JOIN invoices i ON i.id::text = s.payload->>'id'
WHERE s.key = 'deed_invoices' AND abs(coalesce((s.payload->>'amountPaid')::numeric, 0) - i.amount_paid) > 0.01;

\echo ''
\echo '== 11. Paid more than the total =='
SELECT invoice_number, document_type, total_amount, amount_paid FROM invoices
WHERE total_amount > 0 AND amount_paid > total_amount + 0.01;

\echo ''
\echo '== 12. On the screen but not in the ledger =='
SELECT s.payload->>'ref' AS doc, s.payload->>'type' AS kind, s.payload->>'status' AS status,
       (s.payload->>'total')::numeric AS total, s.payload->>'date' AS date, left(s.payload->>'partnerName', 24) AS partner
FROM erp_state_records s LEFT JOIN invoices i ON i.id::text = s.payload->>'id'
WHERE s.key = 'deed_invoices' AND i.id IS NULL AND coalesce(s.payload->>'status', '') NOT IN ('draft', 'cancelled', 'voided');
