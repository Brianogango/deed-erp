#!/usr/bin/env bash
# Apply a SQL file as the local OS postgres role (table owner on Contabo).
# Usage: scripts/apply-sql-as-postgres.sh path/to/file.sql
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="${1:-}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [[ -z "$SQL_FILE" || ! -f "$SQL_FILE" ]]; then
  echo "Usage: $0 path/to/file.sql" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

DB_URL="$(
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^(?:deed_erp_POSTGRES_URL|POSTGRES_URL|DATABASE_URL)=(.*)$/);
      if (!m) continue;
      let v = m[1].trim();
      if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'\''") && v.endsWith("'\''"))) {
        v = v.slice(1, -1);
      }
      process.stdout.write(v);
      process.exit(0);
    }
    process.exit(2);
  ' "$ENV_FILE"
)" || {
  echo "No DATABASE_URL/POSTGRES_URL in $ENV_FILE" >&2
  exit 1
}

DB_NAME="$(
  node -e '
    const u = new URL(process.argv[1]);
    const name = decodeURIComponent(u.pathname.replace(/^\//, "").split("?")[0] || "");
    if (!name) process.exit(2);
    process.stdout.write(name);
  ' "$DB_URL"
)" || {
  echo "Could not parse database name from connection URL" >&2
  exit 1
}

# Resolve absolute path while still running as the deploy user (who can read
# the repo). Pipe SQL on stdin so the postgres OS role never needs filesystem
# access under /var/www (Permission denied on -f for newer migration files).
ABS_SQL="$(cd -- "$(dirname -- "$SQL_FILE")" && pwd)/$(basename -- "$SQL_FILE")"
echo "Applying $(basename -- "$ABS_SQL") to database '$DB_NAME' as OS user postgres…"

run_psql() {
  # shellcheck disable=SC2086
  "$@" -v ON_ERROR_STOP=1 -d "$DB_NAME" -f -
}

if command -v sudo >/dev/null 2>&1; then
  if sudo -n -u postgres true 2>/dev/null; then
    run_psql sudo -n -u postgres psql < "$ABS_SQL"
  else
    run_psql sudo -u postgres psql < "$ABS_SQL"
  fi
else
  # Already running as postgres, or no sudo available
  run_psql psql < "$ABS_SQL"
fi

echo "SQL applied successfully."
