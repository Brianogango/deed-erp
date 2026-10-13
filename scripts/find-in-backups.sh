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
  # Read as the current user (root): backups are root-only files (umask 077),
  # and turning a dump into text needs no database connection.
  rows=$(pg_restore --data-only -t erp_state_records -t app_state -f - "$dump" 2>/tmp/find-in-backups.err \
    | grep -i -E 'deed_buyBacks|deed_clientExchanges')
  if [ -s /tmp/find-in-backups.err ] && [ -z "$rows" ]; then
    echo "  $(basename "$set") ($stamp UTC): COULD NOT READ — $(head -c 200 /tmp/find-in-backups.err)"
    continue
  fi
  # How many buy-backs this backup holds (proves it was read: "0" with no error means none on file).
  n_bbk=$(printf '%s\n' "$rows" | grep -o -E 'BBK/[0-9A-Z/]+' | sort -u | wc -l)
  hits=$(printf '%s\n' "$rows" | grep -i -o -E ".{0,700}${TERM_}.{0,700}" | head -20)
  if [ -n "$hits" ]; then
    found_any=1
    echo
    echo "=================== $(basename "$set")  (taken $stamp UTC) ==================="
    echo "$hits"
  else
    echo "  $(basename "$set") ($stamp UTC): not in buy-backs/exchanges (read OK: $n_bbk buy-back numbers on file)"
  fi
done
latest=$(ls -1d "$ROOT"/*/ 2>/dev/null | sort | tail -1)
echo
echo "Newest backup: $(basename "$latest")"
[ "$found_any" = 1 ] && echo "Send the first and last backup that contain it." || echo "Not found in any backup since $SINCE."
