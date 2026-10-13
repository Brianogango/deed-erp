-- Re-creates the lost Dragonfly trade-in as a DRAFT buy-back:
--   HP Elitebook Dragonfly – Core Intel 7 Gen 8 – 16GB RAM – 512GB SSD,
--   serial 5CG0356RJX (registered 2 Oct by david.karanja), KES 20,000.
--
-- Only the record is created. Approve, pay (or add as credit) and Stock
-- items in the app as usual — that posts the money and moves the machine
-- into stock correctly.
--
-- The customer is found by name (any part of it, case ignored) and must
-- match exactly one customer. The buy-back gets the next server number
-- (BBK/2026/NNNN), the same sequence the app uses.
--
-- PREVIEW (changes nothing):
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" -v customer='Customer Name' < scripts/add-dragonfly-buyback.sql
-- CREATE IT:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v apply=1 -P pager=off -d "$DB" -v customer='Customer Name' < scripts/add-dragonfly-buyback.sql
--
-- Optional: -v price=20000  -v condition=good|fair|poor  -v location=warehouse|shop

\pset null '-'
\if :{?customer}
\else
  \echo 'Give the customer: -v customer=''Their name'''
  \quit
\endif
\if :{?price}
\else
  \set price 20000
\endif
\if :{?condition}
\else
  \set condition good
\endif
\if :{?location}
\else
  \set location warehouse
\endif

BEGIN;

CREATE TEMP TABLE bb_customer ON COMMIT DROP AS
SELECT c.id::text AS id, c.name FROM clients c
WHERE c.name ILIKE '%' || :'customer' || '%';

CREATE TEMP TABLE bb_serial ON COMMIT DROP AS
SELECT s.id::text AS id, s.serial_number, s.status, s.location, s.product_id::text AS product_id, p.name AS product_name
FROM serial_numbers s JOIN products p ON p.id = s.product_id
WHERE s.serial_number = '5CG0356RJX' AND s.removed_at IS NULL;

\echo '1. Customer match (must be exactly one)'
SELECT id, name FROM bb_customer ORDER BY name;

\echo '2. The machine'
SELECT serial_number, status, location, product_name FROM bb_serial;

\echo '3. Buy-backs already holding this serial (should be none)'
SELECT r.payload->>'ref' AS ref, r.payload->>'status' AS status, r.payload->>'customerName' AS customer
FROM erp_state_records r, bb_serial s
WHERE r.key = 'deed_buyBacks' AND r.payload::text LIKE '%' || s.id || '%';

SELECT (SELECT count(*) FROM bb_customer) = 1 AS one_customer,
       (SELECT count(*) FROM bb_serial) = 1 AS serial_found,
       NOT EXISTS (SELECT 1 FROM erp_state_records r, bb_serial s
                   WHERE r.key = 'deed_buyBacks' AND r.payload::text LIKE '%' || s.id || '%') AS not_already_there
\gset

\if :{?apply}
  \if :one_customer
  \else
    \echo 'STOP: the customer name must match exactly one customer (see 1). Nothing created.'
    ROLLBACK;
    \quit
  \endif
  \if :serial_found
  \else
    \echo 'STOP: serial 5CG0356RJX not found. Nothing created.'
    ROLLBACK;
    \quit
  \endif
  \if :not_already_there
  \else
    \echo 'STOP: a buy-back already holds this serial (see 3). Nothing created.'
    ROLLBACK;
    \quit
  \endif

  -- Next number in the server sequence the app uses (BBK_2026).
  INSERT INTO doc_ref_counter (id, current_value, updated_at)
  VALUES ('BBK_' || extract(year FROM now())::int, 1, now()::text)
  ON CONFLICT (id) DO UPDATE SET current_value = doc_ref_counter.current_value + 1, updated_at = now()::text
  RETURNING 'BBK/' || extract(year FROM now())::int || '/' || lpad(current_value::text, 4, '0') AS ref
  \gset

  INSERT INTO erp_state_keys (key, kind, version, updated_at) VALUES ('deed_buyBacks', 'collection', 1, now())
  ON CONFLICT (key) DO UPDATE SET version = erp_state_keys.version + 1, updated_at = now();

  WITH bb AS (SELECT gen_random_uuid()::text AS id, gen_random_uuid()::text AS line_id)
  INSERT INTO erp_state_records (id, key, record_key, position, payload, created_at, updated_at)
  SELECT gen_random_uuid()::text, 'deed_buyBacks', 'id:' || bb.id,
         coalesce((SELECT min(position) FROM erp_state_records WHERE key = 'deed_buyBacks'), 0) - 1,
         jsonb_build_object(
           'id', bb.id,
           'ref', :'ref',
           'customerId', c.id,
           'customerName', c.name,
           'status', 'draft',
           'date', '2026-10-02T08:24:05.000Z',
           'lines', jsonb_build_array(jsonb_build_object(
             'id', bb.line_id,
             'productId', s.product_id,
             'productName', s.product_name,
             'qty', 1,
             'serialIds', jsonb_build_array(s.id),
             'condition', :'condition',
             'unitPrice', (:'price')::numeric
           )),
           'total', (:'price')::numeric,
           'destinationLocation', :'location',
           'notes', 'Re-created ' || to_char(now(), 'YYYY-MM-DD') || ': trade-in of ' || s.serial_number || ' registered 2 Oct by david.karanja; the original buy-back record was lost.'
         ),
         now(), now()
  FROM bb, bb_customer c, bb_serial s;

  SELECT pg_notify('app_state_changed', 'deed_buyBacks');
  COMMIT;
  \echo ''
  \echo 'Created (draft):'
  SELECT payload->>'ref' AS ref, payload->>'customerName' AS customer, payload->>'total' AS total, payload->>'status' AS status
  FROM erp_state_records WHERE key = 'deed_buyBacks' AND payload->>'ref' = :'ref';
  \echo 'Next, in the app: Trade-in → open it → Approve → Pay / Add as credit → Stock items.'
\else
  ROLLBACK;
  \echo ''
  \echo 'Preview only — nothing changed. If 1 shows exactly one customer and 3 shows none, add -v apply=1.'
\endif
