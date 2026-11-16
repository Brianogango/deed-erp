#!/usr/bin/env bash
# Runs the notification scan and worker (POST /api/cron/notifications) on this
# server. Meant for cron, once a minute:
#
#   * * * * * /var/www/deed-erp/scripts/notification-cron.sh >> /var/log/deed-notification-cron.log 2>&1
#
# The secret is read from the app's .env at run time, so it never appears in
# the crontab, the process list or the log. Overlapping runs are skipped.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/deed-erp}"
PORT="${PORT:-3000}"
LOCK="/tmp/deed-notification-cron.lock"

exec 9>"$LOCK"
flock -n 9 || exit 0

secret="$( (grep -h '^CRON_SECRET=' "$APP_DIR"/.env* 2>/dev/null || true) | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
if [ -z "$secret" ]; then
  echo "$(date -Is) CRON_SECRET is not set in $APP_DIR/.env — add one and restart the app (pm2 restart deed-erp --update-env)"
  exit 1
fi

# Empty the body file first. curl writes nothing to it when it cannot connect,
# so a failure used to print the last SUCCESSFUL run's response under a
# "failed" heading — a log line that said HTTP 000 and then showed
# {"ok":true,...} from an hour earlier, which reads as a mystery rather than
# "the app was down".
: > /tmp/deed-notification-cron.out
status="$(curl --silent --show-error --max-time 110 -o /tmp/deed-notification-cron.out -w '%{http_code}' \
  -X POST -H @- "http://127.0.0.1:${PORT}/api/cron/notifications" <<<"Authorization: Bearer ${secret}")" || status="000"

if [ "$status" != "200" ]; then
  body="$(head -c 300 /tmp/deed-notification-cron.out 2>/dev/null)"
  if [ "$status" = "000" ]; then
    echo "$(date -Is) notification run failed: the app did not answer on port ${PORT} (restarting, or stopped)"
  else
    echo "$(date -Is) notification run failed: HTTP $status ${body}"
  fi
  exit 1
fi
