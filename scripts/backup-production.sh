#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/deed-erp}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups}"
TS="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/deed-erp-$TS"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

DB_URL="$(
python3 - <<'PY'
from pathlib import Path
for name in ('.env.production', '.env'):
    p = Path(name)
    if not p.exists():
        continue
    for line in p.read_text(errors='ignore').splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k,v=line.split('=',1)
        if k.strip() in ('DATABASE_URL','POSTGRES_URL') and v.strip():
            print(v.strip().strip('"').strip("'"))
            raise SystemExit
PY
)"

git status --short --branch > "$BACKUP_DIR/git-status.txt" || true
git rev-parse HEAD > "$BACKUP_DIR/git-head.txt" || true

if [ -n "${DB_URL:-}" ]; then
  pg_dump "$DB_URL" -Fc -f "$BACKUP_DIR/database.dump"
  pg_restore --list "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database.dump.list"
fi

tar --exclude='./node_modules' --exclude='./.next/cache' --exclude='./.git/objects' -czf "$BACKUP_DIR/app-files.tar.gz" .
sha256sum "$BACKUP_DIR"/* > "$BACKUP_DIR/SHA256SUMS"

echo "$BACKUP_DIR"
