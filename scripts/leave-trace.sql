-- Read-only. Follows ONE leave request from "applied" to each email:
-- who should get it, who did, what was sent, and why anything wasn't.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -P pager=off -d "$DB" < scripts/leave-trace.sql
--
-- Optional: -v ref='LV/2026/0012'   (default: the newest leave request)

\pset null '-'
\if :{?ref}
\else
  \set ref ''
\endif

SELECT id AS leave_id, reference AS leave_ref FROM leave_requests
WHERE (:'ref' = '' OR reference = :'ref') ORDER BY created_at DESC LIMIT 1
\gset

\echo '1. The leave request'
SELECT l.reference, l.employee_name, l.status, l.created_at::timestamp(0) AS applied,
       su.username AS applied_by, su.role AS applied_by_role
FROM leave_requests l LEFT JOIN users su ON su.id = l.submitted_by_user_id
WHERE l.id = :'leave_id';

\echo ''
\echo '2. Messages created for it, and whether the background sender has processed them'
\echo '   (outbox "queued" for more than a few minutes = the notification worker/cron is not running)'
SELECT ev.created_at::timestamp(0) AS created, ev.event_type, o.status AS outbox, o.attempt_count AS tries,
       o.processed_at::timestamp(0) AS processed, left(coalesce(o.last_error, ''), 120) AS outbox_error,
       ev.metadata->>'emailSenderEmail' AS from_email, ev.metadata->>'emailReplyTo' AS reply_to
FROM notification_events ev LEFT JOIN notification_outbox o ON o.event_id = ev.id
WHERE ev.entity_type = 'leave_request' AND ev.entity_id = :'leave_id'
ORDER BY ev.created_at;

\echo ''
\echo '3. Every email/SMS/app message for it: to whom, status, error'
SELECT ev.event_type, coalesce(u.username, '(outside address)') AS to_user, d.channel, d.destination,
       d.status, d.attempt_count AS tries, d.sent_at::timestamp(0) AS sent, left(coalesce(d.last_error, ''), 140) AS error
FROM notification_deliveries d JOIN notification_events ev ON ev.id = d.event_id
LEFT JOIN users u ON u.id = d.user_id
WHERE ev.entity_type = 'leave_request' AND ev.entity_id = :'leave_id'
ORDER BY ev.event_type, to_user, d.channel;

\echo ''
\echo '4. Who SHOULD get the approval email (active directors) and why one may not'
SELECT u.username, u.role, coalesce(nullif(e.work_email, ''), u.email) AS emailed_at,
       CASE
         WHEN u.id = (SELECT submitted_by_user_id FROM leave_requests WHERE id = :'leave_id') THEN 'SKIPPED: applied it themself'
         WHEN p.email_enabled = false THEN 'SKIPPED: turned email off in notification settings'
         WHEN p.minimum_severity IN ('critical') THEN 'SKIPPED: only wants critical alerts'
         WHEN coalesce(e.work_email, '') = '' THEN 'no work email - goes to login email'
         ELSE 'ok'
       END AS note,
       EXISTS (SELECT 1 FROM notification_deliveries d JOIN notification_events ev ON ev.id = d.event_id
               WHERE d.user_id = u.id AND d.channel = 'email' AND ev.entity_id = :'leave_id') AS email_created
FROM users u
LEFT JOIN employees e ON e.id = u.employee_id
LEFT JOIN notification_preferences p ON p.user_id = u.id AND p.event_type IN ('*', 'hr.leave.approval_required')
WHERE u.is_active AND u.role::text = 'director'
ORDER BY u.role, u.username;

\echo ''
\echo '5. Email sending in the last hour (any event) - proves whether the mailbox login now works'
SELECT d.status, count(*) AS n, max(d.updated_at)::timestamp(0) AS latest, left(max(coalesce(d.last_error, '')), 140) AS an_error
FROM notification_deliveries d
WHERE d.channel = 'email' AND d.updated_at > now() - interval '1 hour'
GROUP BY 1 ORDER BY 1;
