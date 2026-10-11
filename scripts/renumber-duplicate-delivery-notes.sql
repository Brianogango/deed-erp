-- Delivery-note numbers issued twice (DN/2026/0082–0088): the second note of
-- each pair gets the next number in the DN sequence, and its stock moves
-- follow it. The note already in delivery_notes keeps the number (it was
-- saved first).
--
-- PREVIEW (changes nothing):
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/renumber-duplicate-delivery-notes.sql
--
-- APPLY (after checking the preview):
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -v apply=1 -P pager=off -d "$DB" < scripts/renumber-duplicate-delivery-notes.sql
--
-- A stock move is moved to the new number only when it clearly belongs to
-- the second note: its product is on that note and not on the first, or one
-- of its serials is on that note. Anything else stays under the old number
-- and is listed under "moves left as they are".
--
-- A note stored twice under one id (DN/2026/0112) is not a numbering clash
-- and is left alone here; it is listed at the end.

BEGIN;

-- Every delivery note on the screens (one row per note id).
CREATE TEMP TABLE dn_screen ON COMMIT DROP AS
SELECT DISTINCT ON (r.payload->>'id') r.id AS record_id, r.payload->>'id' AS note_id, r.payload->>'ref' AS ref, r.payload
FROM erp_state_records r
WHERE r.key = 'deed_deliveries' AND coalesce(r.payload->>'id', '') <> '' AND coalesce(r.payload->>'ref', '') <> ''
ORDER BY r.payload->>'id', r.updated_at DESC NULLS LAST;

-- Numbers carried by more than one note.
CREATE TEMP TABLE dn_clash ON COMMIT DROP AS
SELECT ref FROM dn_screen GROUP BY ref HAVING count(*) > 1;

-- Which note keeps the number: the one delivery_notes already holds;
-- otherwise the one prepared first.
CREATE TEMP TABLE dn_pair ON COMMIT DROP AS
SELECT s.note_id, s.ref, s.record_id, s.payload,
       row_number() OVER (
         PARTITION BY s.ref
         ORDER BY (EXISTS (SELECT 1 FROM delivery_notes t WHERE t.dn_number = s.ref AND t.id::text = s.note_id)) DESC,
                  coalesce(s.payload->>'preparedAt', s.payload->>'createdAt', '9999') ASC,
                  s.note_id
       ) AS rank
FROM dn_screen s JOIN dn_clash c ON c.ref = s.ref;

CREATE TEMP TABLE dn_renumber (note_id text PRIMARY KEY, old_ref text, new_ref text, record_id text, payload jsonb, keeper_id text) ON COMMIT DROP;
INSERT INTO dn_renumber (note_id, old_ref, record_id, payload, keeper_id)
SELECT p.note_id, p.ref, p.record_id, p.payload, k.note_id
FROM dn_pair p JOIN dn_pair k ON k.ref = p.ref AND k.rank = 1
WHERE p.rank > 1;

-- Next numbers from the real DN sequence (the counter the app uses), in
-- order of the old number. In preview the counter is put back at the end.
DO $$
DECLARE
  r record;
  yr int := extract(year FROM now())::int;
  next_val int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM doc_ref_counter WHERE id = 'DN_' || yr) THEN
    RAISE EXCEPTION 'No DN counter for % yet (doc_ref_counter id DN_%)', yr, yr;
  END IF;
  FOR r IN SELECT note_id FROM dn_renumber ORDER BY old_ref, note_id LOOP
    UPDATE doc_ref_counter SET current_value = current_value + 1, updated_at = now()::text
    WHERE id = 'DN_' || yr RETURNING current_value INTO next_val;
    UPDATE dn_renumber SET new_ref = 'DN/' || yr || '/' || lpad(next_val::text, 4, '0') WHERE note_id = r.note_id;
  END LOOP;
END $$;

-- Products and serial labels on each note's lines.
CREATE TEMP TABLE dn_line ON COMMIT DROP AS
SELECT p.note_id, p.ref, l->>'productId' AS product_id, sid AS serial_id, sn.serial_number AS serial_label
FROM dn_pair p
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.payload->'lines') = 'array' THEN p.payload->'lines' ELSE '[]'::jsonb END) l
LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(l->'serialIds') = 'array' THEN l->'serialIds' ELSE '[]'::jsonb END) sid ON true
LEFT JOIN serial_numbers sn ON sn.id::text = sid;

-- Stock moves under a clashing number, and which note each belongs to.
CREATE TEMP TABLE dn_move ON COMMIT DROP AS
SELECT m.id AS move_id, m.document_ref AS ref,
       coalesce(m.product_id::text, m.screen_extras->>'productId') AS product_id,
       m.serial_numbers, m.created_at, m.screen_extras->>'productName' AS product_name, m.qty,
       (SELECT r.note_id FROM dn_renumber r
         WHERE r.old_ref = m.document_ref
           AND (
             EXISTS (SELECT 1 FROM dn_line x WHERE x.note_id = r.note_id AND x.serial_label = ANY (m.serial_numbers))
             OR (
               EXISTS (SELECT 1 FROM dn_line x WHERE x.note_id = r.note_id AND x.product_id = coalesce(m.product_id::text, m.screen_extras->>'productId'))
               AND NOT EXISTS (SELECT 1 FROM dn_line x WHERE x.note_id = r.keeper_id AND x.product_id = coalesce(m.product_id::text, m.screen_extras->>'productId'))
             )
           )
         LIMIT 1) AS goes_with
FROM stock_movements m
WHERE m.document_ref IN (SELECT ref FROM dn_clash);

\echo '1. Notes that get a new number'
SELECT r.old_ref, r.new_ref, r.payload->>'status' AS status, r.payload->>'saleOrderRef' AS sale_order, r.payload->>'customerName' AS customer,
       CASE WHEN r.payload ? 'reversedAt' THEN 'reversed ' || left(r.payload->>'reversedAt', 10) ELSE '' END AS reversed,
       (SELECT count(*) FROM dn_move m WHERE m.goes_with = r.note_id) AS moves_moving
FROM dn_renumber r ORDER BY r.old_ref;

\echo '2. Notes that keep their number'
SELECT p.ref, p.payload->>'status' AS status, p.payload->>'saleOrderRef' AS sale_order, p.payload->>'customerName' AS customer,
       (SELECT count(*) FROM dn_move m WHERE m.ref = p.ref AND m.goes_with IS NULL) AS moves_staying
FROM dn_pair p WHERE p.rank = 1 ORDER BY p.ref;

\echo '3. Moves left as they are (cannot tell which note they belong to — check by hand)'
SELECT m.ref, m.product_name, m.qty, m.serial_numbers, m.created_at::date AS date
FROM dn_move m
WHERE m.goes_with IS NULL
  AND EXISTS (SELECT 1 FROM dn_line x JOIN dn_renumber r ON r.note_id = x.note_id WHERE r.old_ref = m.ref AND x.product_id = m.product_id)
ORDER BY m.ref;

\echo '4. Stock journals under these numbers (one per number: the second note may have none — listed for the accountant)'
SELECT j.ref, j.entry_date, j.description
FROM journal_entries j
WHERE j.ref IN (SELECT 'JRN/STK/DEL/' || ref FROM dn_clash)
ORDER BY j.ref;

\echo '5. A note stored twice under one id (not renumbered here)'
SELECT r.payload->>'ref' AS ref, left(r.payload->>'id', 8) AS note_id, r.record_key, r.payload->>'status' AS status, r.updated_at
FROM erp_state_records r
WHERE r.key = 'deed_deliveries'
  AND r.payload->>'id' IN (SELECT payload->>'id' FROM erp_state_records WHERE key = 'deed_deliveries' GROUP BY 1 HAVING count(*) > 1)
ORDER BY 1, r.updated_at;

\if :{?apply}
  \echo 'APPLYING'

  -- The notes on the screens.
  UPDATE erp_state_records e
  SET payload = jsonb_set(e.payload, '{ref}', to_jsonb(r.new_ref))
              || jsonb_build_object('renumberedFrom', r.old_ref, 'renumberedAt', now()::text),
      updated_at = now()
  FROM dn_renumber r
  WHERE e.key = 'deed_deliveries' AND e.payload->>'id' = r.note_id;

  -- Their stock moves (the column and the move as the screens show it).
  UPDATE stock_movements m
  SET document_ref = r.new_ref,
      notes = replace(coalesce(m.notes, ''), r.old_ref, r.new_ref),
      screen_extras = CASE WHEN m.screen_extras IS NULL THEN NULL ELSE
        jsonb_set(m.screen_extras, '{documentRef}', to_jsonb(r.new_ref))
        || CASE WHEN m.screen_extras ? 'reason'
                THEN jsonb_build_object('reason', replace(m.screen_extras->>'reason', r.old_ref, r.new_ref))
                ELSE '{}'::jsonb END END
  FROM dn_move d JOIN dn_renumber r ON r.note_id = d.goes_with
  WHERE m.id = d.move_id;

  -- Tell open browsers both lists changed, so they reload them.
  UPDATE erp_state_keys SET version = version + 1 WHERE key IN ('deed_deliveries', 'deed_stockMoves');
  UPDATE app_state SET updated_at = now() WHERE key IN ('deed_deliveries', 'deed_stockMoves');
  SELECT pg_notify('app_state_changed', 'deed_deliveries,deed_stockMoves');

  COMMIT;
  \echo 'Done. Each renumbered note keeps its old number in renumberedFrom.'
\else
  ROLLBACK;
  \echo 'Preview only — nothing changed. Add -v apply=1 to apply.'
\endif
