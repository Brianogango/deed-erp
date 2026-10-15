-- Read-only. Delivery jobs, rider pay and delivery charges.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/delivery-health.sql > /tmp/delivery-health.txt
--   less -S /tmp/delivery-health.txt

\pset null '-'

CREATE TEMP VIEW dj AS
SELECT r.payload->>'id' AS id, r.payload->>'ref' AS ref, r.payload->>'status' AS status, r.payload->>'type' AS type,
       r.payload->>'riderName' AS rider, r.payload->>'customerName' AS customer,
       r.payload->>'invoiceId' AS invoice_id, r.payload->>'invoiceRef' AS invoice_ref,
       nullif(r.payload->>'riderFee', '')::numeric AS rider_fee, nullif(r.payload->>'deliveryFee', '')::numeric AS delivery_fee,
       left(coalesce(r.payload->>'scheduledDate', r.payload->>'createdAt', ''), 10) AS scheduled,
       left(coalesce(r.payload->>'deliveredAt', ''), 10) AS delivered
FROM erp_state_records r WHERE r.key = 'deed_deliveryJobs';

CREATE TEMP VIEW rwp AS
SELECT r.payload->>'ref' AS ref, r.payload->>'riderName' AS rider, r.payload->>'status' AS status,
       nullif(r.payload->>'totalAmount', '')::numeric AS total, r.payload->>'weekStart' AS week_start,
       r.payload->>'invoiceId' AS invoice_id, r.payload->'jobIds' AS job_ids
FROM erp_state_records r WHERE r.key = 'deed_riderWeeklyPays';

\echo '1. Delivery jobs by status'
SELECT status, count(*) AS jobs, sum(rider_fee) AS rider_fees, sum(delivery_fee) AS customer_charges FROM dj GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '2. Not delivered, failed or cancelled after 7 days (pending / assigned / in transit)'
SELECT ref, status, type, rider, customer, invoice_ref, scheduled FROM dj
WHERE status IN ('pending', 'assigned', 'in_transit') AND scheduled <> '' AND scheduled::date < current_date - 7 ORDER BY scheduled;

\echo ''
\echo '3. Delivered trips not in any weekly pay (riders not yet paid for them), older than 7 days'
SELECT rider, count(*) AS trips, sum(rider_fee) AS owed, min(delivered) AS oldest
FROM dj
WHERE status = 'delivered' AND delivered <> '' AND delivered::date < current_date - 7
  AND NOT EXISTS (SELECT 1 FROM rwp WHERE rwp.job_ids ? dj.id)
GROUP BY 1 ORDER BY 3 DESC;

\echo ''
\echo '4. Weekly pays and their bill in Finance (a bill that never reached the server means the rider''s pay is in no accounts)'
SELECT rwp.ref, rwp.rider, rwp.week_start, rwp.total, rwp.status AS pay_status,
       CASE WHEN rwp.invoice_id IS NULL THEN 'no bill raised' WHEN i.id IS NULL THEN 'bill never reached the server'
            ELSE i.invoice_number || ' ' || i.status || ' · paid ' || i.amount_paid END AS bill
FROM rwp LEFT JOIN invoices i ON i.id::text = rwp.invoice_id
ORDER BY rwp.week_start DESC LIMIT 60;

\echo ''
\echo '5. Trips counted in more than one weekly pay'
SELECT j.ref, j.rider, string_agg(rwp.ref, ', ') AS pays
FROM dj j JOIN rwp ON rwp.job_ids ? j.id GROUP BY j.ref, j.rider HAVING count(*) > 1;

\echo ''
\echo '6. Customer delivery charges not on any invoice (charge lost: the invoice was posted, the server refused the extra line)'
SELECT j.ref, j.customer, j.invoice_ref, j.delivery_fee, i.status AS invoice_status,
       EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref = 'JRN/DEL/' || j.invoice_ref) AS charge_journal_posted_anyway
FROM dj j LEFT JOIN invoices i ON i.id::text = j.invoice_id
WHERE j.delivery_fee > 0 AND j.status NOT IN ('cancelled')
  AND NOT EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id::text = j.invoice_id AND it.description ILIKE 'Delivery charge%')
  AND NOT EXISTS (SELECT 1 FROM invoice_items it JOIN invoices i2 ON i2.id = it.invoice_id
                  WHERE it.description ILIKE 'Delivery charge — ' || j.invoice_ref || '%')
ORDER BY j.scheduled DESC;

\echo ''
\echo '7. Delivery job numbers used more than once'
SELECT ref, count(*) FROM dj GROUP BY ref HAVING count(*) > 1 ORDER BY ref;
