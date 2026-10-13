-- Cancels the previous owner's warranty on machines already traded in:
-- stocked buy-backs and completed exchanges (returned machines). From this
-- release on the app does this itself when a buy-back is stocked or an
-- exchange completed; this catches the ones done before.
--
-- Only a warranty that started on or before the trade-in date is cancelled
-- (the trading-in customer's). A warranty given to a later buyer of the same
-- machine is left alone.
--
-- PREVIEW (changes nothing):
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/cancel-tradein-warranties.sql
-- APPLY:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v apply=1 -P pager=off -d "$DB" < scripts/cancel-tradein-warranties.sql

\pset null '-'
BEGIN;

CREATE TEMP TABLE cw_tradein ON COMMIT DROP AS
SELECT b.payload->>'ref' AS ref, b.payload->>'customerName' AS customer,
       left(coalesce(b.payload->>'stockedDate', b.payload->>'date', ''), 10) AS traded_in_on, sid AS serial_id,
       'Bought back from ' || coalesce(b.payload->>'customerName', 'customer') || ' (' || (b.payload->>'ref') || ')' AS reason
FROM erp_state_records b
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.payload->'lines') = 'array' THEN b.payload->'lines' ELSE '[]' END) l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]' END) sid
WHERE b.key = 'deed_buyBacks' AND b.payload->>'status' = 'stocked'
UNION ALL
SELECT e.payload->>'ref', e.payload->>'customerName',
       left(coalesce(e.payload->>'completedDate', e.payload->>'date', ''), 10), sid,
       'Handed back by ' || coalesce(e.payload->>'customerName', 'customer') || ' on exchange ' || (e.payload->>'ref')
FROM erp_state_records e
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.payload->'returnLines') = 'array' THEN e.payload->'returnLines' ELSE '[]' END) l
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]' END) sid
WHERE e.key = 'deed_clientExchanges' AND e.payload->>'status' = 'completed';

CREATE TEMP TABLE cw_target ON COMMIT DROP AS
SELECT DISTINCT ON (w.id) w.id AS record_id, w.payload->>'ref' AS warranty, w.payload->>'customerName' AS warranty_holder,
       w.payload->>'serialNumber' AS serial_number, left(w.payload->>'startDate', 10) AS started, left(w.payload->>'endDate', 10) AS ends,
       w.payload->>'status' AS status_now, t.ref AS trade_in, t.traded_in_on, t.reason
FROM erp_state_records w
JOIN cw_tradein t ON t.serial_id = w.payload->>'serialId'
WHERE w.key = 'deed_warranties'
  AND coalesce(w.payload->>'status', '') <> 'cancelled'
  AND left(coalesce(w.payload->>'startDate', ''), 10) <= t.traded_in_on
ORDER BY w.id, t.traded_in_on;

\echo '1. Warranties that get cancelled (previous owner, machine traded in)'
SELECT warranty, warranty_holder, serial_number, started, ends, status_now, trade_in, traded_in_on FROM cw_target ORDER BY traded_in_on, warranty;

\echo '2. Warranties on the same machines left alone (started after the trade-in: a later buyer)'
SELECT w.payload->>'ref' AS warranty, w.payload->>'customerName' AS holder, w.payload->>'serialNumber' AS serial_number,
       left(w.payload->>'startDate', 10) AS started, w.payload->>'status' AS status, t.ref AS trade_in, t.traded_in_on
FROM erp_state_records w JOIN cw_tradein t ON t.serial_id = w.payload->>'serialId'
WHERE w.key = 'deed_warranties' AND left(coalesce(w.payload->>'startDate', ''), 10) > t.traded_in_on
ORDER BY t.traded_in_on;

\if :{?apply}
  UPDATE erp_state_records w
  SET payload = w.payload || jsonb_build_object('status', 'cancelled', 'cancelledAt', now()::text,
                                                'cancelledReason', t.reason, 'cancelledByRef', t.trade_in),
      updated_at = now()
  FROM cw_target t
  WHERE w.id = t.record_id;

  -- Open screens reload the warranty list.
  UPDATE erp_state_keys SET version = version + 1, updated_at = now() WHERE key = 'deed_warranties';
  SELECT pg_notify('app_state_changed', 'deed_warranties');
  COMMIT;
  \echo 'Done.'
\else
  ROLLBACK;
  \echo 'Preview only — nothing changed. Add -v apply=1 to apply.'
\endif
