-- Read-only. Repair invoices this month and how each is linked to its repair.
-- Invoices linked only from the repair's side (its invoice / its sale order)
-- were missing from the dashboard's Repairs intelligence before the fix.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/repair-revenue-check.sql

\pset null '-'

WITH r AS (
  SELECT id, job_number, nullif(payload->>'invoiceId', '') AS invoice_id, nullif(payload->>'saleOrderId', '') AS sale_order_id
  FROM repairs
), inv AS (
  SELECT i.* FROM invoices i
  WHERE i.document_type = 'customer_invoice'
    AND i.posting_status = 'posted'
    AND date_trunc('month', i.invoice_date) = date_trunc('month', (now() AT TIME ZONE 'Africa/Nairobi')::date)
), linked AS (
  SELECT inv.id, inv.invoice_number, inv.total_amount, inv.amount_paid,
         CASE WHEN inv.repair_id IS NOT NULL THEN 'invoice names the repair'
              WHEN EXISTS (SELECT 1 FROM r WHERE r.invoice_id = inv.id::text) THEN 'only the repair names the invoice'
              WHEN EXISTS (SELECT 1 FROM r WHERE r.sale_order_id = inv.sale_order_id::text) THEN 'through the repair''s sale order'
              ELSE NULL END AS link
  FROM inv
)
SELECT coalesce(link, 'not a repair invoice') AS how_linked, count(*) AS invoices,
       sum(total_amount) AS invoiced, sum(least(amount_paid, total_amount)) AS collected
FROM linked GROUP BY 1 ORDER BY 1;
