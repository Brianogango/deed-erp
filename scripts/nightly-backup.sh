#!/usr/bin/env bash
# Nightly verified backup, then retention. Meant for cron, once a night:
#
#   17 2 * * * root /var/www/deed-erp/scripts/nightly-backup.sh >> /var/log/deed-erp-backup.log 2>&1
#
# The backup itself is backup-db.sh (the same verified dump + files archive
# every deploy takes). Afterwards, backup sets older than KEEP_DAYS are
# removed — the deploy backups too, which were never pruned — but the newest
# KEEP_MIN verified sets always stay, so a run of failed nights never leaves
# you with nothing. Overlapping runs are skipped.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/deed-erp}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/deed-erp}"
KEEP_DAYS="${KEEP_DAYS:-14}"
KEEP_MIN="${KEEP_MIN:-3}"
LOCK="/tmp/deed-erp-backup.lock"

exec 9>"$LOCK"
flock -n 9 || { echo "$(date -Is) another backup is running — skipped"; exit 0; }

echo "$(date -Is) backup starting"
BACKUP_CMD="/usr/local/bin/deed-erp-backup.sh"
[[ -x "$BACKUP_CMD" ]] || BACKUP_CMD="$APP_DIR/scripts/backup-db.sh"
status=0
BACKUP_DIR="$BACKUP_DIR" bash "$BACKUP_CMD" || status=$?
[[ $status -eq 0 ]] && echo "$(date -Is) backup verified" || echo "$(date -Is) BACKUP FAILED (exit $status) — old backups are kept"

# A set is a directory backup-db.sh made: <db>_<YYYYmmddTHHMMSSZ>_<pid>.
is_verified() {
  python3 - "$1/manifest.json" <<'PY' 2>/dev/null
import json, sys
v = json.load(open(sys.argv[1], encoding="utf-8")).get("validation", {})
raise SystemExit(0 if v.get("verified") is True else 1)
PY
}

mapfile -t sets < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*_????????T??????Z_*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
kept_verified=0
removed=0
cutoff=$(( $(date +%s) - KEEP_DAYS * 86400 ))
for set in "${sets[@]}"; do
  if is_verified "$set" && (( kept_verified < KEEP_MIN )); then
    kept_verified=$((kept_verified + 1)); continue
  fi
  if (( $(stat -c %Y "$set") < cutoff )); then
    rm -rf -- "$set"; removed=$((removed + 1))
  fi
done
echo "$(date -Is) retention: removed $removed set(s) older than $KEEP_DAYS days; $(df -h --output=avail "$BACKUP_DIR" | tail -1 | tr -d ' ') free"
exit "$status"
