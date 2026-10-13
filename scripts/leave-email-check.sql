-- Read-only. Why leave emails are not arriving.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/leave-email-check.sql

\pset null '-'

\echo '1. Staff and the email each one is reached at (work email first). Missing work email = fix in HR → employee.'
SELECT trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) AS employee, u.username, u.role,
       e.work_email, u.email AS login_email, e.email AS personal_email,
       coalesce(nullif(e.work_email, ''), u.email, e.email) AS emailed_at,
       CASE WHEN coalesce(e.work_email, '') = '' THEN 'NO WORK EMAIL' ELSE '' END AS note
FROM employees e LEFT JOIN users u ON u.employee_id = e.id
WHERE e.is_active
ORDER BY note DESC, employee;

\echo ''
\echo '2. Leave / salary-advance messages in the last 30 days, per channel (email "suppressed" or "failed" = not sent)'
SELECT ev.event_type, d.channel, d.status, count(*) AS n, max(d.created_at)::timestamp(0) AS latest
FROM notification_deliveries d JOIN notification_events ev ON ev.id = d.event_id
WHERE ev.event_type LIKE 'hr.%' AND d.created_at > now() - interval '30 days'
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

\echo ''
\echo '3. The last 20 HR emails and what happened to each'
SELECT d.created_at::timestamp(0) AS when_, ev.event_type, d.destination, d.status, d.attempt_count AS tries,
       left(coalesce(d.last_error, ''), 160) AS error
FROM notification_deliveries d JOIN notification_events ev ON ev.id = d.event_id
WHERE ev.event_type LIKE 'hr.%' AND d.channel = 'email'
ORDER BY d.created_at DESC LIMIT 20;

\echo ''
\echo '4. Most common email errors (all events, last 7 days)'
SELECT left(coalesce(d.last_error, ''), 160) AS error, count(*) AS n
FROM notification_deliveries d
WHERE d.channel = 'email' AND d.status IN ('failed', 'retrying', 'suppressed') AND d.created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
