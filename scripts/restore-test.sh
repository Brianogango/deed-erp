#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${1:-}"
if [ -z "$BACKUP_DIR" ] || [ ! -f "$BACKUP_DIR/database.dump" ]; then
  echo "Usage: scripts/restore-test.sh /path/to/backup-dir" >&2
  exit 2
fi

TEST_DB_URL="${TEST_DATABASE_URL:-}"
if [ -z "$TEST_DB_URL" ]; then
  echo "Set TEST_DATABASE_URL to an empty disposable PostgreSQL database." >&2
  exit 2
fi

pg_restore --clean --if-exists --no-owner --dbname "$TEST_DB_URL" "$BACKUP_DIR/database.dump"
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -c "select count(*) as app_state_keys from app_state;" >/dev/null
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -c "select count(*) as users from users;" >/dev/null

echo "Restore test passed for $BACKUP_DIR"
