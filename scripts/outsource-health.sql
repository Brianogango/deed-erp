-- Read-only. Outsource jobs, their vendor bills and payments — what Finance
-- needs to reconcile.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/outsource-health.sql > /tmp/outsource-health.txt
--   less -S /tmp/outsource-health.txt

\pset null '-'

CREATE TEMP VIEW oj AS
SELECT r.payload->>'id' AS id, r.payload->>'ref' AS ref, r.payload->>'status' AS status,
       r.payload->>'vendorId' AS vendor_id, r.payload->>'vendorName' AS vendor,
       r.payload->>'deviceDescription' AS device, left(coalesce(r.payload->>'sentDate', r.payload->>'createdAt', ''), 10) AS sent,
       left(coalesce(r.payload->>'returnedDate', ''), 10) AS returned,
       nullif(r.payload->>'finalCost', '')::numeric AS final_cost, r.payload->>'billId' AS bill_id
FROM erp_state_records r WHERE r.key = 'deed_outsourceJobs';

CREATE TEMP VIEW op AS
SELECT r.payload->>'ref' AS ref, r.payload->>'vendorId' AS vendor_id, r.payload->>'vendorName' AS vendor,
       nullif(r.payload->>'amount', '')::numeric AS amount, left(coalesce(r.payload->>'date', ''), 10) AS date,
       coalesce((r.payload->>'postedToAccounts')::boolean, false) AS through_finance, r.payload->>'paidByName' AS by
FROM erp_state_records r WHERE r.key = 'deed_outsourcePayments';

\echo '1. Jobs by status'
SELECT status, count(*) AS jobs, sum(final_cost) AS final_costs FROM oj GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '2. Still at the vendor for more than 14 days'
SELECT ref, vendor, device, sent FROM oj WHERE status = 'sent' AND sent <> '' AND sent::date < current_date - 14 ORDER BY sent;

\echo ''
\echo '3. Returned with a cost but NO bill in Finance (owed, cannot be paid through Finance) — use "Create bill" on the job'
SELECT oj.ref, oj.vendor, oj.device, oj.returned, oj.final_cost,
       CASE WHEN oj.bill_id IS NULL THEN 'no bill' WHEN i.id IS NULL THEN 'bill never reached the server' ELSE 'bill ' || i.status END AS bill
FROM oj LEFT JOIN invoices i ON i.id::text = oj.bill_id
WHERE oj.final_cost > 0 AND (oj.bill_id IS NULL OR i.id IS NULL OR i.status::text = 'cancelled')
ORDER BY oj.returned;

\echo ''
\echo '4. Per vendor: outsource bills in Finance vs payments recorded only in Outsource (NOT in the cash book)'
\echo '   If "paid in Outsource only" covers bills Finance still shows unpaid, those bills were really paid —'
\echo '   Finance records the payment on the bill (date and method from the Outsource record) instead of paying again.'
SELECT v.vendor,
       (SELECT coalesce(sum(i.total_amount), 0) FROM oj JOIN invoices i ON i.id::text = oj.bill_id WHERE oj.vendor_id = v.vendor_id AND i.status::text <> 'cancelled') AS bills_total,
       (SELECT coalesce(sum(i.amount_paid), 0) FROM oj JOIN invoices i ON i.id::text = oj.bill_id WHERE oj.vendor_id = v.vendor_id AND i.status::text <> 'cancelled') AS paid_in_finance,
       (SELECT coalesce(sum(amount), 0) FROM op WHERE op.vendor_id = v.vendor_id AND NOT through_finance) AS paid_in_outsource_only,
       (SELECT string_agg(ref || ' ' || amount || ' on ' || date, ', ' ORDER BY date) FROM op WHERE op.vendor_id = v.vendor_id AND NOT through_finance) AS outsource_only_payments
FROM (SELECT DISTINCT vendor_id, vendor FROM oj UNION SELECT DISTINCT vendor_id, vendor FROM op) v
ORDER BY 4 DESC, 1;

\echo ''
\echo '5. Outsource bills in Finance (each job''s bill, its number and state)'
SELECT oj.ref AS job, oj.vendor, i.invoice_number AS bill, i.status, i.total_amount, i.amount_paid, i.invoice_date
FROM oj JOIN invoices i ON i.id::text = oj.bill_id ORDER BY i.invoice_date DESC LIMIT 60;

\echo ''
\echo '6. Job numbers used more than once (numbers used to be counted per screen)'
SELECT ref, count(*) AS times, string_agg(vendor || ' / ' || coalesce(device, ''), ' | ') AS jobs
FROM oj GROUP BY ref HAVING count(*) > 1 ORDER BY ref;
