-- Read-only. POS till sales, their stock, invoices and journals.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/pos-health.sql > /tmp/pos-health.txt
--   less -S /tmp/pos-health.txt

\pset null '-'

CREATE TEMP VIEW po AS
SELECT r.payload->>'id' AS id, r.payload->>'ref' AS ref,
       left(coalesce(r.payload->>'date', r.payload->>'createdAt', ''), 10) AS sale_date,
       r.payload->>'payment' AS method, r.payload->>'bankAccountId' AS bank_id,
       r.payload->>'paymentReference' AS pay_ref, r.payload->>'customerName' AS customer,
       r.payload->>'createdByName' AS cashier,
       nullif(r.payload->>'total', '')::numeric AS total,
       coalesce(nullif(r.payload->>'customerCreditAmount', '')::numeric, 0) AS client_credit,
       r.payload->'lines' AS lines
FROM erp_state_records r WHERE r.key = 'deed_posOrders';

\echo '1. Till sales by month'
SELECT left(sale_date, 7) AS month, method, count(*) AS sales, sum(total) AS total
FROM po GROUP BY 1, 2 ORDER BY 1 DESC, 2;

\echo ''
\echo '2. One POS number on more than one sale'
SELECT ref, count(*) AS sales, string_agg(sale_date || ' ' || total || ' ' || coalesce(cashier, '?'), ' | ') AS which
FROM po GROUP BY ref HAVING count(*) > 1 ORDER BY ref;

\echo ''
\echo '3. Sales with no journal in the books (revenue and cash/bank missing)'
SELECT po.ref, po.sale_date, po.method, po.total, po.cashier
FROM po
WHERE po.total > 0
  AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.ref = 'JRN/' || po.ref OR j.blob_id = po.id)
ORDER BY po.sale_date DESC;

\echo ''
\echo '4. Sales with no invoice record (missing from customer statements and sales reports)'
SELECT po.ref, po.sale_date, po.total, po.customer
FROM po WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.invoice_number = po.ref)
ORDER BY po.sale_date DESC;

\echo ''
\echo '5. Paid into a bank account added on the Bank accounts screen: which account the journal actually used'
\echo '   (these were booked to the I&M/ABSA account instead of their own)'
SELECT po.ref, po.sale_date, po.total,
       coalesce(b.payload->>'name', '?') AS paid_into,
       string_agg(DISTINCT a.code || ' ' || a.name, ', ') FILTER (WHERE l.debit > 0) AS journal_debited
FROM po
LEFT JOIN erp_state_records b ON b.key = 'deed_bankAccounts' AND b.payload->>'id' = po.bank_id
LEFT JOIN journal_entries j ON j.ref = 'JRN/' || po.ref
LEFT JOIN journal_entry_lines l ON l.journal_entry_id = j.id
LEFT JOIN account_codes a ON a.id = l.account_id
WHERE po.bank_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.id::text = po.bank_id)
GROUP BY po.ref, po.sale_date, po.total, b.payload->>'name'
ORDER BY po.sale_date DESC;

\echo ''
\echo '6. One serial number on more than one till sale'
SELECT l->>'serialNumber' AS serial, count(*) AS sales, string_agg(po.ref || ' ' || po.sale_date, ', ') AS which
FROM po, jsonb_array_elements(po.lines) l
WHERE coalesce(l->>'serialNumber', '') <> ''
GROUP BY 1 HAVING count(*) > 1 ORDER BY 1;

\echo ''
\echo '7. Stock taken by the till with no sale recorded (charge failed after stock left)'
SELECT m.document_ref, min(m.created_at)::date AS taken, count(*) AS moves, sum(m.qty) AS units
FROM stock_movements m
WHERE m.document_ref LIKE 'POS/%' AND m.removed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM po WHERE po.ref = m.document_ref)
GROUP BY m.document_ref ORDER BY taken DESC;

\echo ''
\echo '8. Sold below the catalogue price (price typed in at the till; a unit with its own price shows here too)'
SELECT po.ref, po.sale_date, po.cashier, l->>'productName' AS product, l->>'serialNumber' AS serial,
       (l->>'price')::numeric AS sold_at, p.selling_price AS list_price,
       round(p.selling_price - (l->>'price')::numeric, 2) AS discount
FROM po CROSS JOIN LATERAL jsonb_array_elements(po.lines) l
JOIN products p ON p.id::text = l->>'productId' OR p.screen_extras->>'id' = l->>'productId'
WHERE (l->>'price')::numeric < p.selling_price
ORDER BY po.sale_date DESC LIMIT 100;
