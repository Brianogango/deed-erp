-- Sale order lines keep every assigned serial, not just the first.
-- NON-DESTRUCTIVE: adds one column with a default and fills it; deletes nothing.
BEGIN;

ALTER TABLE sale_order_items ADD COLUMN IF NOT EXISTS serial_ids text[] NOT NULL DEFAULT '{}';

-- 1. The one serial each line already had.
UPDATE sale_order_items
   SET serial_ids = ARRAY[serial_number_id::text]
 WHERE serial_number_id IS NOT NULL
   AND cardinality(serial_ids) = 0;

-- 2. Serials assigned to the order on screen but dropped when the order was
--    saved (only the first was kept). Recovered from the serial records, for
--    lines that are the only line of that product on the order.
WITH single_lines AS (
  SELECT i.id, i.sale_order_id, i.product_id, i.qty
    FROM sale_order_items i
   WHERE i.product_id IS NOT NULL
     AND i.qty > 1
     AND (SELECT count(*) FROM sale_order_items j
           WHERE j.sale_order_id = i.sale_order_id AND j.product_id = i.product_id) = 1
),
assigned AS (
  SELECT l.id AS item_id, l.qty, s.id::text AS serial_id, s.serial_number
    FROM single_lines l
    JOIN serial_numbers s
      ON s.product_id = l.product_id
     AND s.screen_extras ->> 'saleOrderId' = l.sale_order_id::text
     AND s.status IN ('assigned', 'reserved', 'sold')
     AND s.removed_at IS NULL
),
merged AS (
  SELECT a.item_id,
         (SELECT array_agg(x ORDER BY ord)
            FROM (
              SELECT DISTINCT ON (x) x, ord FROM (
                SELECT unnest(i.serial_ids) AS x, 0 AS ord
                UNION ALL
                SELECT a2.serial_id, 1 FROM assigned a2 WHERE a2.item_id = a.item_id
              ) u ORDER BY x, ord
            ) d) AS ids,
         max(a.qty) AS qty
    FROM assigned a
    JOIN sale_order_items i ON i.id = a.item_id
   GROUP BY a.item_id, i.serial_ids
)
UPDATE sale_order_items i
   SET serial_ids = m.ids[1:m.qty]
  FROM merged m
 WHERE i.id = m.item_id
   AND cardinality(m.ids) > cardinality(i.serial_ids);

COMMIT;

-- Lines that now carry more than one serial.
SELECT count(*) AS lines_with_several_serials FROM sale_order_items WHERE cardinality(serial_ids) > 1;
