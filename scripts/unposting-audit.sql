-- Read-only. Reports only; changes nothing.
--
-- Finds invoices whose GL journal was reversed by the un-posting bug: the
-- server treated a stale tab's `status: draft` as Reset to Draft, reversed the
-- journal and cleared the posting link, and told nobody.

\echo ''
\echo '=== 1. Looks posted to users, but is NOT in the general ledger ==='
\echo '    (the material set: revenue and AR silently out of the books)'
\echo ''
SELECT i.invoice_number,
       i.invoice_date,
       i.status,
       i.document_type,
       i.total_amount,
       i.amount_paid,
       j.ref              AS reversed_journal,
       rev.created_at     AS reversed_at
FROM invoices i
JOIN journal_entries j   ON j.invoice_id = i.id AND j.ref NOT LIKE 'REV/%'
JOIN journal_entries rev ON rev.reversal_of_id = j.id
WHERE i.posting_status <> 'posted'
  AND i.status IN ('approved', 'invoiced', 'paid', 'partially_paid')
ORDER BY rev.created_at DESC;

\echo ''
\echo '=== 2. Un-posted then re-posted (JRN/INV/.../2, /3 ...) ==='
\echo '    Recovered by hand, but each pair leaves a reversal in the ledger.'
\echo ''
SELECT i.invoice_number,
       i.invoice_date,
       i.status,
       i.total_amount,
       count(*) FILTER (WHERE j.ref LIKE 'REV/%')      AS reversals,
       count(*) FILTER (WHERE j.ref NOT LIKE 'REV/%')  AS postings
FROM invoices i
JOIN journal_entries j ON j.invoice_id = i.id
GROUP BY i.id, i.invoice_number, i.invoice_date, i.status, i.total_amount
HAVING count(*) FILTER (WHERE j.ref LIKE 'REV/%') > 0
   AND i.posting_status = 'posted'
ORDER BY 5 DESC, i.invoice_date DESC;

\echo ''
\echo '=== 3. Totals ==='
\echo ''
SELECT count(*)                       AS invoices_out_of_ledger,
       coalesce(sum(i.total_amount),0) AS value_out_of_ledger
FROM invoices i
WHERE i.posting_status <> 'posted'
  AND i.status IN ('approved', 'invoiced', 'paid', 'partially_paid')
  AND EXISTS (
    SELECT 1 FROM journal_entries j
    JOIN journal_entries rev ON rev.reversal_of_id = j.id
    WHERE j.invoice_id = i.id AND j.ref NOT LIKE 'REV/%'
  );

\echo ''
\echo '=== 4. Reversals by month, to see whether this is still happening ==='
\echo ''
SELECT date_trunc('month', rev.created_at)::date AS month,
       count(*) AS invoice_journal_reversals
FROM journal_entries rev
JOIN journal_entries j ON rev.reversal_of_id = j.id
WHERE j.invoice_id IS NOT NULL
GROUP BY 1
ORDER BY 1;
