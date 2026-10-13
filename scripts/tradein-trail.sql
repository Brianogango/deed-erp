-- Read-only. Where did the Dragonfly trade-in (serial 5CG0356RJX) go?
-- Shows the full registration entry (which screen: buyback / exchange /
-- donation-in / rma) and everything the same user did around that time:
-- what they created, approved, paid, deleted.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/tradein-trail.sql > /tmp/tradein-trail.txt
--   less -S /tmp/tradein-trail.txt
--
-- Optional: -v serial='5CG0356RJX'  -v hours=6  (window after the registration)

\pset null '-'
\pset format wrapped
\if :{?serial}
\else
  \set serial '5CG0356RJX'
\endif
\if :{?hours}
\else
  \set hours 6
\endif

\echo '1. The registration, in full (the end says which screen: "via buyback / exchange / donation-in / rma …")'
SELECT a.created_at::timestamp(0) AS when_, u.username AS who, a.action, a.entity_key,
       coalesce(a.new_values->>'details', a.new_values::text) AS details
FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
WHERE a.entity_key = :'serial' OR a.new_values::text LIKE '%' || :'serial' || '%'
ORDER BY a.created_at;

SELECT min(a.created_at) AS t0, (array_agg(a.user_id ORDER BY a.created_at))[1] AS uid
FROM audit_logs a WHERE a.entity_key = :'serial' AND a.action = 'serial_return_intake'
\gset

\echo ''
\echo '2. Everything that user did from 30 minutes before to the end of the window (server audit log)'
SELECT a.created_at::timestamp(0) AS when_, a.action, coalesce(a.entity_key, '') AS record,
       left(coalesce(a.new_values->>'details', a.new_values::text, a.old_values::text, ''), 220) AS details
FROM audit_logs a
WHERE a.user_id = :'uid'
  AND a.created_at BETWEEN (:'t0'::timestamptz - interval '30 minutes') AND (:'t0'::timestamptz + (:'hours' || ' hours')::interval)
ORDER BY a.created_at;

\echo ''
\echo '3. Trade-in / exchange / return / donation activity by ANYONE in that window'
SELECT a.created_at::timestamp(0) AS when_, u.username AS who, a.action, coalesce(a.entity_key, '') AS record,
       left(coalesce(a.new_values->>'details', a.new_values::text, ''), 220) AS details
FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
WHERE a.created_at BETWEEN (:'t0'::timestamptz - interval '30 minutes') AND (:'t0'::timestamptz + (:'hours' || ' hours')::interval)
  AND (a.action ~* 'buyback|buy_back|exchange|return|rma|donation|trade|serial_return|delete'
       OR coalesce(a.entity_key, '') ~* '^(BBK|EXC|RMA|DON)')
ORDER BY a.created_at;

\echo ''
\echo '4. Store saves of trade-in lists in that window (who saved buy-backs / exchanges / returns, and how many records)'
SELECT a.created_at::timestamp(0) AS when_, u.username AS who, a.action,
       left(coalesce(a.new_values::text, ''), 260) AS details
FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
WHERE a.created_at BETWEEN (:'t0'::timestamptz - interval '30 minutes') AND (:'t0'::timestamptz + (:'hours' || ' hours')::interval)
  AND a.new_values::text ~ 'deed_buyBacks|deed_clientExchanges|deed_returnOrders|deed_donations'
ORDER BY a.created_at;

\echo ''
\echo '5. Returns (RMA), donations and exchanges on file for this machine or product'
SELECT r.key AS kind, coalesce(r.payload->>'ref', left(r.payload->>'id', 8)) AS record, r.payload->>'status' AS status,
       coalesce(r.payload->>'customerName', r.payload->>'party', '') AS party,
       left(coalesce(r.payload->>'date', r.payload->>'createdAt', ''), 16) AS date
FROM erp_state_records r
WHERE r.key IN ('deed_returnOrders', 'deed_donations', 'deed_clientExchanges', 'deed_buyBacks')
  AND (r.payload::text LIKE '%' || (SELECT id::text FROM serial_numbers WHERE serial_number = :'serial' LIMIT 1) || '%'
       OR r.payload::text ILIKE '%dragonfly%');

\echo ''
\echo '6. The serial row as stored (who it was linked to)'
SELECT s.serial_number, s.status, s.location, s.created_at::timestamp(0) AS added, s.screen_extras
FROM serial_numbers s WHERE s.serial_number = :'serial';
