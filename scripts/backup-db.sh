#!/usr/bin/env bash
# Backup the Deed ERP PostgreSQL database (schema + data) before deploying changes.
#
# Usage (run on the server that can reach the database):
#   DATABASE_URL=postgresql://user:pass@host:5432/deed_erp ./scripts/backup-db.sh [output-dir]
#
# Produces three artifacts in the output dir (default: ./backups):
#   deed_erp_<timestamp>.dump  — pg_dump custom format (restore with pg_restore)
#   deed_erp_<timestamp>.sql   — plain SQL dump (human-readable / psql restore)
#   app_state_<timestamp>.csv  — export of the app_state table, which holds the
#                                JSON blobs for repairs, quotes, invoices, etc.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set (postgresql://user:pass@host:port/db)}"

OUT_DIR="${1:-backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUT_DIR"

echo "==> Dumping full database (custom format)..."
pg_dump --format=custom --no-owner --file "$OUT_DIR/deed_erp_${STAMP}.dump" "$DATABASE_URL"

echo "==> Dumping full database (plain SQL)..."
pg_dump --format=plain --no-owner --file "$OUT_DIR/deed_erp_${STAMP}.sql" "$DATABASE_URL"

echo "==> Exporting app_state table (repairs/quotes/invoices JSON blobs)..."
psql "$DATABASE_URL" -c "\copy (SELECT key, value, updated_at FROM app_state ORDER BY key) TO '$OUT_DIR/app_state_${STAMP}.csv' WITH CSV HEADER" || \
  echo "    (app_state table not found — skipped)"

echo "==> Backup complete:"
ls -lh "$OUT_DIR" | grep "$STAMP"
echo
echo "Restore with:  pg_restore --clean --if-exists -d \"\$DATABASE_URL\" $OUT_DIR/deed_erp_${STAMP}.dump"
