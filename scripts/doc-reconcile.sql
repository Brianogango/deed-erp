-- Read-only: for every invoice and bill whose ledger balance disagrees with the
-- document, split the ledger into "booked" (the sale/bill entry) and "settled"
-- (payment entries), compare with the payments recorded, and name the cause.
-- Writes nothing.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/doc-reconcile.sql

\echo ''
\echo '== Documents whose ledger balance disagrees, by cause (summary) =='
\echo '   booked  = net sale/bill entry on AR (invoices) or AP (bills)'
\echo '   settled = net payment entries;  recorded = payments recorded on the document'

CREATE TEMP TABLE rec AS
WITH docs AS (
  SELECT id, invoice_number AS num, document_type::text AS t, invoice_date AS dt,
         total_amount AS tot, amount_paid AS paid
  FROM invoices
  WHERE status::text NOT IN ('draft', 'cancelled', 'void') AND total_amount <> 0
),
x AS (
  SELECT j.invoice_id, regexp_replace(j.ref, '^(REV/)+', '') AS base,
         sum(CASE WHEN l.account_label LIKE '1800%' THEN l.debit - l.credit ELSE 0 END) AS ar,
         sum(CASE WHEN l.account_label LIKE '3000%' THEN l.credit - l.debit ELSE 0 END) AS ap
  FROM journal_entries j JOIN journal_entry_lines l ON l.journal_entry_id = j.id
  WHERE j.is_posted AND j.invoice_id IS NOT NULL
  GROUP BY j.id, j.invoice_id, j.ref
),
comp AS (
  SELECT d.id,
         coalesce(sum(CASE WHEN d.t = 'vendor_bill' THEN x.ap ELSE x.ar END)
                  FILTER (WHERE x.base NOT LIKE 'JRN/PAY%' AND x.base NOT LIKE 'JRN/DEP/%'), 0) AS booked,
         coalesce(sum(CASE WHEN d.t = 'vendor_bill' THEN -x.ap ELSE -x.ar END)
                  FILTER (WHERE x.base LIKE 'JRN/PAY%' OR x.base LIKE 'JRN/DEP/%'), 0) AS settled,
         coalesce(sum(CASE WHEN d.t = 'vendor_bill' THEN x.ar ELSE x.ap END), 0) AS other_side,
         count(*) FILTER (WHERE x.base LIKE 'JRN/PAY%') AS pay_entries
  FROM docs d JOIN x ON x.invoice_id = d.id
  GROUP BY d.id
),
pay AS (
  SELECT invoice_id, count(*) AS n, sum(amount) AS amt FROM (
    SELECT a.invoice_id, a.payment_id, sum(a.amount) AS amount
    FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
    WHERE NOT p.is_voided AND a.reversed_at IS NULL
    GROUP BY a.invoice_id, a.payment_id
    UNION ALL
    SELECT p.invoice_id, p.id, p.amount FROM payments p
    WHERE NOT p.is_voided AND p.invoice_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id)
  ) u GROUP BY invoice_id
),
unlinked AS (
  SELECT d.id, count(*) AS n, sum(j.total_debit) AS amt
  FROM docs d JOIN journal_entries j
    ON (j.ref = 'JRN/' || d.num OR j.ref LIKE 'JRN/' || d.num || '/%')
   AND j.invoice_id IS NULL AND NOT j.is_reversed AND j.reversal_of_id IS NULL
  GROUP BY d.id
)
SELECT d.num, d.dt, CASE WHEN d.t = 'vendor_bill' THEN 'bill' ELSE 'invoice' END AS kind,
       d.tot, d.paid,
       round(coalesce(c.booked, 0), 2) AS booked,
       round(coalesce(c.settled, 0), 2) AS settled,
       round(coalesce(p.amt, 0), 2) AS recorded, coalesce(p.n, 0) AS payments, coalesce(c.pay_entries, 0) AS pay_entries,
       round(coalesce(c.other_side, 0), 2) AS other_side,
       coalesce(u.n, 0) AS unlinked_entries,
       CASE
         WHEN d.num LIKE 'POS%' AND abs(coalesce(c.booked, 0) - d.tot) > 1 THEN 'P. till sale (booked by the POS entry, not by document)'
         WHEN abs(coalesce(c.booked, 0) - d.tot) > 1 AND coalesce(u.n, 0) > 0 THEN 'A. booked, but entry not linked to the document'
         WHEN abs(coalesce(c.booked, 0)) < 1 THEN 'B. never booked (or booked and reversed)'
         WHEN abs(c.booked - d.tot) > 1 THEN 'C. booked at a different amount'
         WHEN coalesce(c.settled, 0) > coalesce(p.amt, 0) + 1 THEN 'D. payment booked more than once'
         WHEN coalesce(c.settled, 0) < coalesce(p.amt, 0) - 1 THEN 'E. payment recorded but not booked'
         WHEN abs(d.paid - coalesce(p.amt, 0)) > 1 THEN 'F. paid figure differs from payments recorded'
         WHEN abs(coalesce(c.other_side, 0)) > 1 THEN 'G. posted to the wrong side (AR on a bill / AP on an invoice)'
         ELSE 'ok'
       END AS cause
FROM docs d
LEFT JOIN comp c ON c.id = d.id
LEFT JOIN pay p ON p.invoice_id = d.id
LEFT JOIN unlinked u ON u.id = d.id;

SELECT cause, count(*) AS docs,
       round(sum(abs(booked - tot)), 2) AS booked_gap,
       round(sum(settled - recorded), 2) AS settled_minus_recorded,
       round(sum(paid - recorded), 2) AS paid_minus_recorded
FROM rec WHERE cause <> 'ok' GROUP BY cause ORDER BY cause;

\echo ''
\echo '== Detail, biggest first (60 rows) =='
SELECT num, dt, kind, tot, paid, booked, settled, recorded, payments, pay_entries, other_side, unlinked_entries, cause
FROM rec WHERE cause <> 'ok'
ORDER BY cause, greatest(abs(booked - tot), abs(settled - recorded), abs(paid - recorded), abs(other_side)) DESC
LIMIT 60;
