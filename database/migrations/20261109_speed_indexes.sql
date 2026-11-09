-- Speed: indexes for the joins the screen lists run on every load.
-- NON-DESTRUCTIVE: creates indexes only. CONCURRENTLY: the tables stay
-- readable and writable while each index is built. Safe to run again.
--
-- Run on the server as the postgres role (psql runs each statement on its
-- own, which CONCURRENTLY needs). postgres cannot read the app folder, so
-- copy the file out first:
--   install -m 644 /var/www/deed-erp/database/migrations/20261109_speed_indexes.sql /tmp/speed_indexes.sql
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d deed_erp -f /tmp/speed_indexes.sql

-- Every invoice read joins its lines by invoice; this had no index (full scan of all lines).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id);
-- Sale orders find their invoices by sale_order_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_sale_order ON invoices (sale_order_id);
-- The sale-order list is ordered by creation date.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_orders_created ON sale_orders (created_at);
-- Purchase orders and quotes join their lines.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_po_items_po ON purchase_order_items (po_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quote_items_quote ON quote_items (quote_id);
-- Credit notes are looked up by invoice, and their lines by the invoice line credited.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_notes_invoice ON credit_notes (invoice_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_note_lines_item ON credit_note_lines (original_invoice_item_id);

-- Refresh the planner's statistics so it uses them straight away.
ANALYZE invoice_items, invoices, sale_orders, purchase_order_items, quote_items, credit_notes, credit_note_lines;
