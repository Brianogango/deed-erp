-- Read-only. Expense claims and their journals.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/expenses-health.sql > /tmp/expenses-health.txt
--   less -S /tmp/expenses-health.txt

\pset null '-'

CREATE TEMP VIEW ex AS
SELECT r.payload->>'id' AS id, r.payload->>'ref' AS ref, r.payload->>'status' AS status,
       r.payload->>'submittedByName' AS submitted_by, r.payload->>'category' AS category,
       r.payload->>'paymentMethod' AS method, left(r.payload->>'description', 50) AS description,
       nullif(r.payload->>'amount', '')::numeric AS amount,
       left(coalesce(r.payload->>'expenseDate', ''), 10) AS expense_date,
       left(coalesce(r.payload->>'submittedDate', r.payload->>'createdAt', ''), 10) AS submitted,
       left(coalesce(r.payload->>'reviewedDate', ''), 10) AS reviewed,
       left(coalesce(r.payload->>'paidDate', r.payload->>'reimbursementDate', ''), 10) AS paid
FROM erp_state_records r WHERE r.key = 'deed_expenses';

\echo '1. Claims by status'
SELECT status, method, count(*) AS claims, sum(amount) AS total FROM ex GROUP BY 1, 2 ORDER BY 1, 2;

\echo ''
\echo '2. One EXP number on more than one claim (each browser counted on its own; the later claim''s journal was skipped as "already posted")'
SELECT ref, count(*) AS claims, string_agg(submitted_by || ' ' || amount || ' ' || status, ' | ' ORDER BY submitted) AS which
FROM ex GROUP BY ref HAVING count(*) > 1 ORDER BY ref;

\echo ''
\echo '3. Approved / paid claims whose approval journal is not in the books, or belongs to another claim with the same number'
SELECT ex.ref, ex.submitted_by, ex.amount, ex.status, ex.reviewed,
       CASE WHEN je.id IS NULL THEN 'no journal' ELSE 'journal is another claim''s (' || je.total_debit || ')' END AS problem
FROM ex
LEFT JOIN journal_entries je ON je.ref = 'JRN/EXP/' || ex.ref
WHERE ex.status IN ('approved', 'paid', 'reimbursed')
  AND (je.id IS NULL OR coalesce(je.blob_id, je.source_id, '') NOT LIKE ex.id || '%')
ORDER BY ex.reviewed;

\echo ''
\echo '4. Paid / reimbursed claims with no payment journal (the money left, the books do not show it)'
SELECT ex.ref, ex.submitted_by, ex.amount, ex.status, ex.method, ex.paid
FROM ex
WHERE (ex.status = 'paid' AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref = 'JRN/EXPPAY/' || ex.ref
                                           AND coalesce(je.blob_id, je.source_id, '') LIKE ex.id || '%'))
   OR (ex.status = 'reimbursed' AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref = 'JRN/RIM/' || ex.ref
                                           AND coalesce(je.blob_id, je.source_id, '') LIKE ex.id || '%'))
ORDER BY ex.paid;

\echo ''
\echo '5. Approved but not paid / reimbursed after 14 days (owed to staff or suppliers)'
SELECT ref, submitted_by, method, amount, reviewed, description FROM ex
WHERE status = 'approved' AND reviewed <> '' AND reviewed::date < current_date - 14 ORDER BY reviewed;

\echo ''
\echo '6. Waiting for approval more than 7 days'
SELECT ref, submitted_by, amount, submitted, description FROM ex
WHERE status = 'submitted' AND submitted <> '' AND submitted::date < current_date - 7 ORDER BY submitted;

\echo ''
\echo '7. Expense journals in the books with no matching claim (claim deleted or renumbered after posting)'
SELECT je.ref, je.entry_date, je.total_debit, je.is_reversed FROM journal_entries je
WHERE je.source_type = 'expense'
  AND NOT EXISTS (SELECT 1 FROM ex WHERE coalesce(je.blob_id, je.source_id, '') LIKE ex.id || '%')
ORDER BY je.entry_date;
