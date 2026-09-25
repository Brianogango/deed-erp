-- 011: quotation and sale order lines keep the order the user put them in.
--
-- sale_order_items had no ordering column at all. Every read was
-- `include: { items: true }` with no ORDER BY, so Postgres returned rows in
-- physical order and a reorder in the UI had nowhere to be stored. The PATCH
-- that followed a reorder upserted each line by id with identical data and
-- changed nothing, so the next hydration replayed the original order.
--
-- Safe to re-run.

ALTER TABLE sale_order_items
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill from physical row order — exactly what the unordered SELECT has
-- been returning — so every existing quotation opens in the order it shows
-- today rather than being reshuffled by this migration.
--
-- Only sale orders where every line is still at the default are touched. Once
-- a user has ordered a document, at least one line is non-zero and the whole
-- document is left alone, so re-running can never flatten a real order.
WITH never_ordered AS (
  SELECT sale_order_id
  FROM sale_order_items
  GROUP BY sale_order_id
  HAVING COUNT(*) > 1 AND MAX(sort_order) = 0
),
positioned AS (
  SELECT
    i.id,
    ROW_NUMBER() OVER (PARTITION BY i.sale_order_id ORDER BY i.ctid) - 1 AS position
  FROM sale_order_items i
  JOIN never_ordered n ON n.sale_order_id = i.sale_order_id
)
UPDATE sale_order_items AS i
SET sort_order = p.position
FROM positioned p
WHERE i.id = p.id;

CREATE INDEX IF NOT EXISTS idx_sale_order_items_order
  ON sale_order_items (sale_order_id, sort_order);
