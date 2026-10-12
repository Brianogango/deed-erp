-- Correct a validated goods receipt whose quantity and unit cost were typed
-- the wrong way round (e.g. 750 @ 5 instead of 5 @ 750). Only use it when the
-- line's total value is the same both ways — the journal then stays right and
-- is not touched — and while none of the extra stock has been sold or moved.
--
-- PREVIEW (changes nothing):
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" -v ref='REC/2026/0245' -v pid='7367f227-bbc0-4be2-b1ae-7e8aca8d1c5b' \
--     -v old_qty=750 -v new_qty=5 -v old_cost=5 -v new_cost=750 < scripts/fix-receipt-qty-cost.sql
--
-- APPLY: the same command with -v apply=1 -v ON_ERROR_STOP=1 added.
--
-- Every value is changed only where it still holds the wrong figure. Once
-- applied, running it again stops at the stock check and changes nothing.

\pset null '-'
BEGIN;

CREATE TEMP TABLE fix AS SELECT :'ref'::text AS ref, :'pid'::text AS pid,
  :'old_qty'::int AS old_qty, :'new_qty'::int AS new_qty,
  :'old_cost'::numeric AS old_cost, :'new_cost'::numeric AS new_cost,
  (:'old_qty'::int - :'new_qty'::int) AS excess;

\echo 'Check: value the same both ways, and the extra stock still in the warehouse'
SELECT f.old_qty * f.old_cost AS value_as_entered, f.new_qty * f.new_cost AS value_corrected,
       (f.old_qty * f.old_cost = f.new_qty * f.new_cost) AS same_value,
       (SELECT qty FROM stock_location_levels WHERE product_id = f.pid AND location = 'warehouse') AS warehouse_now,
       f.excess AS to_take_off
FROM fix f;

\echo '1. Receipt line'
SELECT d.ref, d.status, l->>'productName' AS product, l->>'qtyExpected' AS expected, l->>'qtyReceived' AS received
FROM receipt_documents d, fix f, jsonb_array_elements(d.record->'lines') l
WHERE d.ref = f.ref AND l->>'productId' = f.pid;

\echo '2. Purchase order line'
SELECT po.po_number, i.qty_ordered, i.qty_received, i.qty_billed, i.unit_cost, i.line_total
FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id, fix f
WHERE i.product_id::text = f.pid AND po.id::text = (SELECT d.po_id FROM receipt_documents d WHERE d.ref = f.ref LIMIT 1);

\echo '3. Goods received note line'
SELECT g.grn_number, gi.qty_received, gi.unit_cost
FROM grn_items gi JOIN goods_received_notes g ON g.id = gi.grn_id, fix f
WHERE g.grn_number = f.ref AND gi.product_id::text = f.pid;

\echo '4. Supplier bill lines for that PO line (total stays the same)'
SELECT inv.invoice_number, inv.posting_status, ii.qty, ii.unit_price, ii.line_total
FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id, fix f
WHERE ii.product_id::text = f.pid AND ii.qty = f.old_qty AND ii.unit_price = f.old_cost;

\echo '5. Stock movement, batch, valuation and ledger'
SELECT 'movement' AS what, m.qty::numeric AS qty, m.unit_cost AS cost FROM stock_movements m, fix f WHERE m.document_ref = f.ref AND (m.product_id::text = f.pid OR m.screen_extras->>'productId' = f.pid)
UNION ALL SELECT 'batch ' || b.batch_number, b.quantity_received, b.unit_cost FROM inventory_batches b, fix f WHERE b.product_id::text = f.pid AND b.unit_cost = f.old_cost AND b.quantity_received = f.old_qty
UNION ALL SELECT 'valuation event', v.qty, v.unit_cost FROM valuation_events v, fix f WHERE v.product_id::text = f.pid AND v.reference = f.ref
UNION ALL SELECT 'ledger ' || e.movement_type, e.quantity, e.unit_cost FROM inventory_ledger_entries e, fix f WHERE e.product_id::text = f.pid AND e.unit_cost = f.old_cost AND e.quantity = f.old_qty;

\echo '6. Product stock and cost now'
SELECT p.name, p.cost_price, p.selling_price, sl.qty_on_hand, pv.total_qty AS valued_qty, pv.average_cost, pv.total_value,
       p.screen_extras->>'stockQty' AS screen_stock, p.screen_extras->>'costPrice' AS screen_cost, p.screen_extras->>'salePrice' AS screen_price
FROM products p, fix f
LEFT JOIN stock_levels sl ON sl.product_id::text = f.pid
LEFT JOIN product_valuations pv ON pv.product_id::text = f.pid
WHERE p.id::text = f.pid;

\if :{?apply}
  \echo 'APPLYING'
  DO $$
  DECLARE f record; wh int;
  BEGIN
    SELECT * INTO f FROM fix;
    IF f.old_qty * f.old_cost <> f.new_qty * f.new_cost THEN
      RAISE EXCEPTION 'Values differ (% vs %): this script only swaps quantity and cost of equal value', f.old_qty * f.old_cost, f.new_qty * f.new_cost;
    END IF;
    SELECT qty INTO wh FROM stock_location_levels WHERE product_id = f.pid AND location = 'warehouse';
    IF coalesce(wh, 0) < f.excess THEN
      RAISE EXCEPTION 'Only % in the warehouse; % would have to come off — some stock has moved. Stop and check.', wh, f.excess;
    END IF;
  END $$;

  -- Receipt (as the screens show it)
  UPDATE receipt_documents d SET record = jsonb_set(d.record, '{lines}', (
      SELECT jsonb_agg(CASE WHEN l->>'productId' = f.pid AND (l->>'qtyReceived')::numeric = f.old_qty
                            THEN l || jsonb_build_object('qtyReceived', f.new_qty,
                                                         'qtyExpected', CASE WHEN (l->>'qtyExpected')::numeric = f.old_qty THEN f.new_qty ELSE (l->>'qtyExpected')::numeric END)
                            ELSE l END ORDER BY o)
      FROM jsonb_array_elements(d.record->'lines') WITH ORDINALITY AS t(l, o))), updated_at = now()
  FROM fix f WHERE d.ref = f.ref;

  -- Purchase order line
  UPDATE purchase_order_items i SET
    qty_ordered = CASE WHEN i.qty_ordered = f.old_qty THEN f.new_qty ELSE i.qty_ordered END,
    qty_received = greatest(0, i.qty_received - f.excess),
    qty_billed = CASE WHEN i.qty_billed = f.old_qty THEN f.new_qty ELSE i.qty_billed END,
    unit_cost = f.new_cost
  FROM fix f
  WHERE i.product_id::text = f.pid AND i.unit_cost = f.old_cost AND i.qty_received >= f.old_qty
    AND i.po_id::text = (SELECT d.po_id FROM receipt_documents d WHERE d.ref = f.ref LIMIT 1);
  UPDATE purchase_orders po SET updated_at = now() FROM fix f
  WHERE po.id::text = (SELECT d.po_id FROM receipt_documents d WHERE d.ref = f.ref LIMIT 1);

  -- Goods received note line
  UPDATE grn_items gi SET qty_received = f.new_qty, unit_cost = f.new_cost
  FROM goods_received_notes g, fix f
  WHERE g.id = gi.grn_id AND g.grn_number = f.ref AND gi.product_id::text = f.pid AND gi.qty_received = f.old_qty AND gi.unit_cost = f.old_cost;

  -- Supplier bill lines (same total)
  UPDATE invoice_items ii SET qty = f.new_qty, unit_price = f.new_cost
  FROM fix f WHERE ii.product_id::text = f.pid AND ii.qty = f.old_qty AND ii.unit_price = f.old_cost;

  -- Stock movement
  UPDATE stock_movements m SET qty = f.new_qty, qty_after = f.new_qty,
    unit_cost = CASE WHEN m.unit_cost = f.old_cost THEN f.new_cost ELSE m.unit_cost END,
    screen_extras = CASE WHEN m.screen_extras IS NULL THEN NULL ELSE m.screen_extras || jsonb_build_object('qty', f.new_qty) END
  FROM fix f WHERE m.document_ref = f.ref AND (m.product_id::text = f.pid OR m.screen_extras->>'productId' = f.pid) AND m.qty = f.old_qty;

  -- Batch, valuation event, ledger
  UPDATE inventory_batches b SET quantity_received = f.new_qty, quantity_available = greatest(0, b.quantity_available - f.excess), unit_cost = f.new_cost, updated_at = now()
  FROM fix f WHERE b.product_id::text = f.pid AND b.unit_cost = f.old_cost AND b.quantity_received = f.old_qty;
  UPDATE valuation_events v SET qty = f.new_qty, unit_cost = f.new_cost
  FROM fix f WHERE v.product_id::text = f.pid AND v.reference = f.ref AND v.qty = f.old_qty;
  UPDATE inventory_ledger_entries e SET quantity = f.new_qty, unit_cost = f.new_cost
  FROM fix f WHERE e.product_id::text = f.pid AND e.unit_cost = f.old_cost AND e.quantity = f.old_qty;

  -- Stock on hand (every place it is kept)
  UPDATE stock_location_levels l SET qty = l.qty - f.excess, updated_at = now()
  FROM fix f WHERE l.product_id = f.pid AND l.location = 'warehouse';
  UPDATE bulk_stock_levels l SET qty = greatest(0, l.qty - f.excess), updated_at = now()
  FROM fix f WHERE l.product_id::text = f.pid AND l.location = 'warehouse' AND l.qty >= f.excess;
  UPDATE stock_levels sl SET qty_on_hand = greatest(0, sl.qty_on_hand - f.excess), updated_at = now()
  FROM fix f WHERE sl.product_id::text = f.pid;

  -- Average cost: same total value over the right quantity
  UPDATE product_valuations pv SET total_qty = greatest(0, pv.total_qty - f.excess),
    average_cost = CASE WHEN pv.total_qty - f.excess > 0 THEN round(pv.total_value / (pv.total_qty - f.excess), 4) ELSE pv.average_cost END
  FROM fix f WHERE pv.product_id::text = f.pid AND pv.total_qty >= f.excess;
  UPDATE products p SET
    cost_price = coalesce((SELECT pv.average_cost FROM product_valuations pv WHERE pv.product_id = p.id), f.new_cost),
    screen_extras = CASE WHEN p.screen_extras IS NULL THEN NULL ELSE p.screen_extras
      || jsonb_build_object('costPrice', coalesce((SELECT pv.average_cost FROM product_valuations pv WHERE pv.product_id = p.id), f.new_cost))
      || CASE WHEN p.screen_extras ? 'stockQty' THEN jsonb_build_object('stockQty', greatest(0, (p.screen_extras->>'stockQty')::numeric - f.excess)) ELSE '{}'::jsonb END
      || CASE WHEN p.screen_extras ? 'onHand' THEN jsonb_build_object('onHand', greatest(0, (p.screen_extras->>'onHand')::numeric - f.excess)) ELSE '{}'::jsonb END
      || CASE WHEN p.screen_extras ? 'cost' THEN jsonb_build_object('cost', coalesce((SELECT pv.average_cost FROM product_valuations pv WHERE pv.product_id = p.id), f.new_cost)) ELSE '{}'::jsonb END
      END,
    updated_at = now()
  FROM fix f WHERE p.id::text = f.pid;

  -- Open screens reload these lists.
  UPDATE erp_state_keys SET version = version + 1 WHERE key IN ('deed_receipts', 'deed_purchaseOrders', 'deed_stockMoves', 'deed_bulkStock', 'deed_products', 'deed_invoices');
  SELECT pg_notify('app_state_changed', 'deed_receipts,deed_purchaseOrders,deed_stockMoves,deed_bulkStock,deed_products,deed_invoices');
  COMMIT;

  \echo 'After'
  SELECT p.name, p.cost_price, p.selling_price,
         (SELECT qty FROM stock_location_levels WHERE product_id = f.pid AND location = 'warehouse') AS warehouse,
         (SELECT qty_on_hand FROM stock_levels WHERE product_id::text = f.pid) AS on_hand
  FROM products p, fix f WHERE p.id::text = f.pid;
  \echo 'Check the selling price above: it may have been recalculated from the wrong cost of 5. Set it in Inventory if so.'
\else
  ROLLBACK;
  \echo 'Preview only — nothing changed. Add -v apply=1 -v ON_ERROR_STOP=1 to apply.'
\endif
