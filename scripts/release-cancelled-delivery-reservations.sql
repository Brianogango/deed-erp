-- Release stock still held by delivery notes that were cancelled before the
-- fix of 22 Oct 2026 (cancelling never released the delivery's reservation).
-- Only reservations of CANCELLED delivery notes that are still 'reserved'.
-- Safe to run more than once. Nothing is deleted.

\echo 'Will release:'
SELECT dn.dn_number AS delivery, sr.screen_extras->>'productName' AS item, sr.qty
  FROM stock_reservations sr
  JOIN delivery_notes dn ON dn.blob_id = sr.screen_extras->>'deliveryId'
 WHERE dn.status = 'cancelled' AND sr.status = 'reserved' AND sr.removed_at IS NULL
 ORDER BY 1, 2;

BEGIN;
UPDATE stock_reservations sr
   SET status = 'cancelled',
       released_at = now(),
       updated_at = now(),
       screen_extras = COALESCE(sr.screen_extras, '{}'::jsonb) || jsonb_build_object(
         'status', 'cancelled',
         'releasedDate', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'notes', trim(COALESCE(sr.screen_extras->>'notes', '') || ' · released: delivery ' || dn.dn_number || ' was cancelled')
       )
  FROM delivery_notes dn
 WHERE dn.blob_id = sr.screen_extras->>'deliveryId'
   AND dn.status = 'cancelled'
   AND sr.status = 'reserved'
   AND sr.removed_at IS NULL;
COMMIT;

\echo 'Still held by cancelled deliveries (should be 0):'
SELECT count(*) FROM stock_reservations sr
  JOIN delivery_notes dn ON dn.blob_id = sr.screen_extras->>'deliveryId'
 WHERE dn.status = 'cancelled' AND sr.status = 'reserved' AND sr.removed_at IS NULL;
