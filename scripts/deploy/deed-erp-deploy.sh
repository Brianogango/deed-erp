#!/usr/bin/env bash
# Deed ERP production deploy — called by the GitHub Actions pipeline
# (or manually). Backs up the DB, fast-forwards to origin/master, builds,
# restarts pm2 and health-checks the app.
set -euo pipefail

LOG=/var/log/deed-erp-deploy.log
exec > >(tee -a "$LOG") 2>&1

echo "=== Deploy started $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
cd /var/www/deed-erp

echo "--- Pre-deploy database backup"
/usr/local/bin/deed-erp-backup.sh

echo "--- Sync to origin/master"
git fetch origin master
git checkout -B master origin/master
git log --oneline -1

echo "--- Install dependencies"
pnpm install --frozen-lockfile

echo "--- Build"
pnpm build

echo "--- Restart"
pm2 restart deed-erp --update-env
sleep 10

echo "--- Health check (up to 120s — npm start regenerates the Prisma client first)"
for i in $(seq 1 24); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login || true)
  if [ "$code" = "200" ]; then
    echo "Healthy after ~$((i * 5))s (HTTP $code)"
    echo "=== Deploy OK $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    exit 0
  fi
  sleep 5
done

echo "Health check FAILED (last HTTP code: ${code:-none}) — check pm2 logs deed-erp"
exit 1
