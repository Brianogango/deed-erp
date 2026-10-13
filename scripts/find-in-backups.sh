#!/usr/bin/env bash
# Read-only. Looks inside each nightly backup for a buy-back / exchange that
# mentions a word (default "dragonfly") — to recover a trade-in that has
# since disappeared from the live system. Nothing is restored: each backup's
# dump is only read (pg_restore to text) and searched.
#
#   cd /var/www/deed-erp
#   sudo bash scripts/find-in-backups.sh dragonfly > /tmp/backup-dragonfly.txt 2>&1
#   less -S /tmp/backup-dragonfly.txt
#
# Optional second argument: only backups taken on/after this date (YYYY-MM-DD).

TERM_="${1:-dragonfly}"
SINCE="${2:-2026-10-01}"
ROOT="${BACKUP_DIR:-/var/backups/deed-erp}"

[ -d "$ROOT" ] || { echo "No backup folder at $ROOT"; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore not found"; exit 1; }

echo "Searching backups in $ROOT taken on/after $SINCE for \"$TERM_\""
found_any=0
for set in $(ls -1d "$ROOT"/*/ 2>/dev/null | sort); do
  dump="$set/database.dump"
  [ -f "$dump" ] || continue
  stamp=$(date -u -r "$dump" +%Y-%m-%d\ %H:%M)
  [[ "${stamp:0:10}" < "$SINCE" ]] && continue
  # Buy-backs and exchanges live as one row per record (erp_state_records)
  # and, in older backups, as one list (app_state). Print each hit with a
  # little text around it.
  hits=$(sudo -u postgres pg_restore --data-only -t erp_state_records -t app_state -f - "$dump" 2>/dev/null \
    | grep -i -E 'deed_buyBacks|deed_clientExchanges' \
    | grep -i -o -E ".{0,700}${TERM_}.{0,700}" | head -20)
  if [ -n "$hits" ]; then
    found_any=1
    echo
    echo "=================== $(basename "$set")  (taken $stamp UTC) ==================="
    echo "$hits"
  else
    echo "  $(basename "$set") ($stamp UTC): not in buy-backs/exchanges"
  fi
done
echo
[ "$found_any" = 1 ] && echo "Send the first and last backup that contain it." || echo "Not found in any backup since $SINCE."
