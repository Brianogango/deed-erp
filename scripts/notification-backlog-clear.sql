-- Run ONCE, just before switching notification email on
-- (NOTIFICATIONS_PAUSE_EMAIL=false). Anything that has waited more than a day
-- in the notification queue is marked done without being sent, so turning
-- email on does not flood customers and staff with old payment receipts,
-- repair messages and reminders. Nothing is deleted; in-app notifications
-- are not affected.
--
--   cd /var/www/deed-erp
--   DB=$(grep -h '^DATABASE_URL' .env* | head -1 | sed -E 's#.*/([^/?"]+).*#\1#')
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -P pager=off -d "$DB" < scripts/notification-backlog-clear.sql

\echo 'Waiting in the queue now'
SELECT 'events not yet routed' AS waiting, count(*) AS total,
       count(*) FILTER (WHERE created_at < now() - interval '1 day') AS older_than_a_day
FROM notification_outbox WHERE status IN ('queued', 'retrying', 'processing')
UNION ALL
SELECT 'messages not yet sent: ' || channel, count(*),
       count(*) FILTER (WHERE created_at < now() - interval '1 day')
FROM notification_deliveries WHERE status IN ('queued', 'retrying', 'sending') AND channel <> 'in_app'
GROUP BY channel;

BEGIN;
UPDATE notification_outbox
SET status = 'processed', processed_at = now(), locked_at = NULL, locked_by = NULL,
    last_error = 'skipped_old_backlog', updated_at = now()
WHERE status IN ('queued', 'retrying', 'processing') AND created_at < now() - interval '1 day';

UPDATE notification_deliveries
SET status = 'suppressed', last_error = 'skipped_old_backlog', updated_at = now()
WHERE status IN ('queued', 'retrying', 'sending') AND channel <> 'in_app'
  AND created_at < now() - interval '1 day';
COMMIT;

\echo 'Left in the queue (only the last day remains)'
SELECT 'events not yet routed' AS waiting, count(*) AS total
FROM notification_outbox WHERE status IN ('queued', 'retrying', 'processing')
UNION ALL
SELECT 'messages not yet sent: ' || channel, count(*)
FROM notification_deliveries WHERE status IN ('queued', 'retrying', 'sending') AND channel <> 'in_app'
GROUP BY channel;
