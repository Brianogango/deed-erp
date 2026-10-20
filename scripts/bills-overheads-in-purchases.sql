-- Read-only. Vendor bills charged to Purchases / cost of sales (6001–6399)
-- by vendors that never had a purchase order — usually rent, power, water,
-- internet or another overhead that belongs in an operating expense account
-- (6401–6799). Nothing is changed; you decide which ones to move.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/bills-overheads-in-purchases.sql > /tmp/bills-overheads.txt
--   less -S /tmp/bills-overheads.txt
--
-- To move one: open the bill, Reset to draft, pick the expense account on
-- each line (or set the vendor's usual account), and post it again.

\pset null '-'

CREATE TEMP VIEW hit AS
SELECT i.id, i.invoice_number AS bill, i.invoice_date AS bill_date, c.id AS vendor_id, c.name AS vendor,
       j.ref AS journal, a.code, a.name AS account, l.debit, l.label
FROM invoices i
JOIN clients c ON c.id = i.client_id
JOIN journal_entries j ON j.id = i.posted_journal_entry_id
  OR (i.posted_journal_entry_id IS NULL AND j.ref = 'JRN/' || i.invoice_number)
JOIN journal_entry_lines l ON l.journal_entry_id = j.id
JOIN account_codes a ON a.id = l.account_id
WHERE i.document_type = 'vendor_bill'
  AND i.posting_status = 'posted'
  AND j.is_reversed IS NOT TRUE
  AND l.debit > 0
  AND a.code ~ '^6[0-3][0-9]{2}$'
  AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.client_id = c.id OR po.supplier_id = c.id)
  AND i.purchase_order_id IS NULL;

\echo '1. By vendor: how much went to Purchases / cost of sales'
SELECT vendor, count(DISTINCT id) AS bills, sum(debit) AS amount, min(bill_date) AS first, max(bill_date) AS last,
       string_agg(DISTINCT code || ' ' || account, ', ') AS charged_to
FROM hit GROUP BY vendor ORDER BY sum(debit) DESC;

\echo ''
\echo '2. Every bill line (newest first)'
SELECT bill, bill_date, vendor, code || ' ' || account AS charged_to, debit AS amount, left(coalesce(label, ''), 60) AS line
FROM hit ORDER BY bill_date DESC, bill;

\echo ''
\echo '3. Total by month'
SELECT to_char(bill_date, 'YYYY-MM') AS month, count(DISTINCT id) AS bills, sum(debit) AS amount
FROM hit GROUP BY 1 ORDER BY 1 DESC;
