-- Read-only. Invoices someone completed that don't show in the ERP.
-- Looks for a customer (default "kingsun") and for every invoice of the last
-- few days, everywhere an invoice can be: the invoices table, sales orders,
-- the server's activity log, and the old frozen copy.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" -v term='kingsun' < scripts/find-missing-invoices.sql > /tmp/missing-inv.txt
--   less -S /tmp/missing-inv.txt
--
-- Optional: -v days=3  (how far back)

\pset null '-'
\if :{?term}
\else
  \set term 'kingsun'
\endif
\if :{?days}
\else
  \set days 3
\endif

\echo '1. Customers matching the name'
SELECT c.id, c.name, c.company_name, c.phone, c.is_active AS active
FROM clients c
WHERE c.name ILIKE '%' || :'term' || '%' OR coalesce(c.company_name, '') ILIKE '%' || :'term' || '%'
ORDER BY c.name;

\echo ''
\echo '2. Their invoices (all time, newest first) - status, who made it, when'
SELECT i.invoice_number, i.status, i.posting_status AS posting, i.invoice_date, i.total_amount, i.amount_paid,
       i.created_at::timestamp(0) AS created, u.username AS created_by, so.order_number AS sale_order
FROM invoices i
JOIN clients c ON c.id = i.client_id
LEFT JOIN users u ON u.id = i.created_by
LEFT JOIN sale_orders so ON so.id = i.sale_order_id
WHERE c.name ILIKE '%' || :'term' || '%' OR coalesce(c.company_name, '') ILIKE '%' || :'term' || '%'
ORDER BY i.created_at DESC LIMIT 30;

\echo ''
\echo '3. Their sales orders in the window - an order confirmed but with no invoice is a likely "missing" one'
SELECT so.order_number, so.status, so.total_amount, so.created_at::timestamp(0) AS created, so.updated_at::timestamp(0) AS last_change,
       (SELECT string_agg(i.invoice_number || ' (' || i.status || ')', ', ') FROM invoices i WHERE i.sale_order_id = so.id) AS invoices
FROM sale_orders so JOIN clients c ON c.id = so.client_id
WHERE (c.name ILIKE '%' || :'term' || '%' OR coalesce(c.company_name, '') ILIKE '%' || :'term' || '%')
  AND so.updated_at > now() - (:'days' || ' days')::interval
ORDER BY so.updated_at DESC;

\echo ''
\echo '4. ALL invoices created in the window, per day / status / person (are yesterday''s there at all?)'
SELECT i.created_at::date AS day, i.status, coalesce(u.username, '-') AS created_by, count(*) AS n, sum(i.total_amount) AS total
FROM invoices i LEFT JOIN users u ON u.id = i.created_by
WHERE i.created_at > now() - (:'days' || ' days')::interval
GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3;

\echo ''
\echo '5. Activity log: invoice actions in the window (create / confirm / post / pay / delete / cancel)'
SELECT a.created_at::timestamp(0) AS when_, coalesce(u.username, '-') AS who, a.action, coalesce(a.entity_key, a.entity_id::text, '') AS record,
       left(coalesce(a.new_values::text, a.old_values::text, ''), 160) AS details,
       CASE WHEN a.entity_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.invoice_number = a.entity_key)
                 AND a.entity_key ~ '^(INV|BILL)' THEN 'NOT IN INVOICES TABLE' ELSE '' END AS note
FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
WHERE a.created_at > now() - (:'days' || ' days')::interval
  AND (a.action ILIKE '%invoice%' OR a.entity_type ILIKE '%invoice%' OR coalesce(a.entity_key, '') ~ '^INV')
ORDER BY a.created_at DESC LIMIT 80;

\echo ''
\echo '6. Activity log mentioning the customer in the window'
SELECT a.created_at::timestamp(0) AS when_, coalesce(u.username, '-') AS who, a.action, coalesce(a.entity_key, '') AS record,
       left(coalesce(a.new_values::text, a.old_values::text, ''), 200) AS details
FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
WHERE a.created_at > now() - (:'days' || ' days')::interval
  AND (a.new_values::text ILIKE '%' || :'term' || '%' OR a.old_values::text ILIKE '%' || :'term' || '%')
ORDER BY a.created_at DESC LIMIT 60;

\echo ''
\echo '7. Old frozen copy (screens no longer read it): invoices there that are NOT in the invoices table'
SELECT r.payload->>'ref' AS ref, r.payload->>'status' AS status, r.payload->>'customerName' AS customer,
       r.payload->>'total' AS total, r.updated_at::timestamp(0) AS saved
FROM erp_state_records r
WHERE r.key = 'deed_invoices'
  AND r.updated_at > now() - (:'days' || ' days')::interval
  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.invoice_number = r.payload->>'ref')
ORDER BY r.updated_at DESC LIMIT 40;

\echo ''
\echo '8. Repairs / POS for the customer marked invoiced or paid in the window but with no invoice row'
SELECT r.job_number, r.status, r.invoice_id, r.updated_at::timestamp(0) AS last_change
FROM repairs r JOIN clients c ON c.id = r.client_id
WHERE (c.name ILIKE '%' || :'term' || '%' OR coalesce(c.company_name, '') ILIKE '%' || :'term' || '%')
  AND r.updated_at > now() - (:'days' || ' days')::interval
ORDER BY r.updated_at DESC;
