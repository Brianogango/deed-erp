-- Read-only. Repair invoices filed under a different customer than the repair.
-- (Before 6 Oct 2026 a new invoice whose customer the server did not know yet
-- was matched to any contact sharing an email or phone.)
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/invoices-wrong-customer-repairs.sql
--
-- To correct them: Finance → Accounting → Integrity controls →
-- "Invoices under the wrong customer" → Check → untick any billed to someone
-- else on purpose → Correct.

\pset null '-'

WITH link AS (
  SELECT i.id AS invoice_id, r.id AS repair_id
  FROM invoices i
  JOIN repairs r ON r.id = i.repair_id
     OR r.invoice_id = i.id
     OR r.payload->>'invoiceId' = i.id::text
     OR (i.sale_order_id IS NOT NULL AND r.payload->>'saleOrderId' = i.sale_order_id::text)
  WHERE i.document_type = 'customer_invoice' AND i.status::text NOT IN ('cancelled', 'voided')
), hit AS (
  SELECT DISTINCT ON (i.id) i.invoice_number AS invoice, i.invoice_date AS date, i.total_amount AS amount,
         i.amount_paid AS paid, ic.name AS filed_under, rc.name AS repair_customer, r.job_number AS repair
  FROM link l
  JOIN invoices i ON i.id = l.invoice_id
  JOIN repairs r ON r.id = l.repair_id
  JOIN clients ic ON ic.id = i.client_id
  JOIN clients rc ON rc.id = r.client_id
  WHERE i.client_id <> r.client_id
    AND lower(trim(ic.name)) <> lower(trim(rc.name))
  ORDER BY i.id
)
SELECT * FROM hit ORDER BY date;

\echo ''
\echo 'Summary: how many, and under whose name'
WITH link AS (
  SELECT i.id AS invoice_id, r.id AS repair_id FROM invoices i
  JOIN repairs r ON r.id = i.repair_id OR r.invoice_id = i.id OR r.payload->>'invoiceId' = i.id::text
     OR (i.sale_order_id IS NOT NULL AND r.payload->>'saleOrderId' = i.sale_order_id::text)
  WHERE i.document_type = 'customer_invoice' AND i.status::text NOT IN ('cancelled', 'voided')
)
SELECT ic.name AS filed_under, count(DISTINCT i.id) AS invoices, sum(DISTINCT i.total_amount) AS approx_amount
FROM link l JOIN invoices i ON i.id = l.invoice_id JOIN repairs r ON r.id = l.repair_id
JOIN clients ic ON ic.id = i.client_id JOIN clients rc ON rc.id = r.client_id
WHERE i.client_id <> r.client_id AND lower(trim(ic.name)) <> lower(trim(rc.name))
GROUP BY ic.name ORDER BY 2 DESC;
