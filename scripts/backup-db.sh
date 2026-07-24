#!/usr/bin/env bash
# Fail-closed Deed ERP database and filesystem backup.
set -Eeuo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/var/www/deed-erp}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BLOB_STORE_DIR="${BLOB_STORE_DIR:-/var/lib/deed-erp/blobs}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/www/deed-erp/.uploads}"
OUT_DIR="${1:-${BACKUP_DIR:-/var/backups/deed-erp}}"
BACKUP_RESTORE_MODE="${BACKUP_RESTORE_MODE:-restore}"
BACKUP_RESULT_FILE="${BACKUP_RESULT_FILE:-}"

usage() {
  cat <<'EOF'
Usage: backup-db.sh [output-directory]

Creates one PostgreSQL custom-format dump plus archives of the blob and upload
directories, writes a SHA-256 manifest, and verifies the backup with an isolated
temporary restore. DATABASE_URL is read from the environment or ENV_FILE
(default: /var/www/deed-erp/.env).

Configuration:
  BACKUP_DIR             Default output directory (/var/backups/deed-erp)
  BLOB_STORE_DIR         Blob directory (/var/lib/deed-erp/blobs)
  UPLOADS_DIR            Upload directory (/var/www/deed-erp/.uploads)
  BACKUP_RESTORE_MODE    "restore" (default) or "skip"
  BACKUP_RESTORE_OS_USER Local PostgreSQL OS user; root/local auto-selects
                         postgres. Use "credential" to disable OS-user restore.
  VERIFY_SCRIPT          Path to verify-backup.sh
  BACKUP_RESULT_FILE     Receives the verified manifest path on success

Skipping restore deliberately returns a failure and never marks the backup
verified. This is appropriate for artifact-only runs, not pre-deploy backups.
EOF
}

die() {
  printf 'BACKUP FAILED: %s\n' "$*" >&2
  exit 1
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
[[ $# -le 1 ]] || die "too many arguments (see --help)"
[[ "$BACKUP_RESTORE_MODE" == "restore" || "$BACKUP_RESTORE_MODE" == "skip" ]] ||
  die "BACKUP_RESTORE_MODE must be restore or skip"

for command in python3 psql pg_dump pg_restore tar sha256sum stat git; do
  command -v "$command" >/dev/null 2>&1 || die "required command not found: $command"
done
[[ -d "$BLOB_STORE_DIR" ]] || die "blob directory does not exist: $BLOB_STORE_DIR"
[[ -d "$UPLOADS_DIR" ]] || die "upload directory does not exist: $UPLOADS_DIR"

# Parse the URL without evaluating the .env file. The password is passed to
# libpq through its environment, never as a command argument.
mapfile -d '' -t pg_settings < <(
  DATABASE_URL="${DATABASE_URL:-}" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import ast
import os
import re
import sys
from urllib.parse import parse_qs, unquote, urlsplit

url = os.environ.get("DATABASE_URL", "")
if not url:
    env_file = os.environ["ENV_FILE"]
    try:
        lines = open(env_file, encoding="utf-8").read().splitlines()
    except OSError as exc:
        raise SystemExit(f"cannot read DATABASE_URL from {env_file}: {exc}")
    for line in lines:
        match = re.match(r"^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$", line)
        if not match:
            continue
        value = match.group(1)
        if value[:1] in {"'", '"'}:
            try:
                value = ast.literal_eval(value)
            except (SyntaxError, ValueError):
                raise SystemExit("DATABASE_URL has invalid quoting")
        else:
            value = value.split(" #", 1)[0].strip()
        url = value
        break
if not url:
    raise SystemExit("DATABASE_URL is not set and was not found in ENV_FILE")

parsed = urlsplit(url)
if parsed.scheme not in {"postgres", "postgresql"}:
    raise SystemExit("DATABASE_URL must use the postgres or postgresql scheme")
if not parsed.path or parsed.path == "/":
    raise SystemExit("DATABASE_URL does not name a database")

query = parse_qs(parsed.query, keep_blank_values=True)
settings = {
    "PGHOST": parsed.hostname or "",
    "PGPORT": str(parsed.port or 5432),
    "PGUSER": unquote(parsed.username or ""),
    "PGPASSWORD": unquote(parsed.password or ""),
    "PGDATABASE": unquote(parsed.path.lstrip("/")),
}
query_map = {
    "sslmode": "PGSSLMODE",
    "sslrootcert": "PGSSLROOTCERT",
    "sslcert": "PGSSLCERT",
    "sslkey": "PGSSLKEY",
    "connect_timeout": "PGCONNECT_TIMEOUT",
    "application_name": "PGAPPNAME",
    "target_session_attrs": "PGTARGETSESSIONATTRS",
}
for source, target in query_map.items():
    if source in query:
        settings[target] = query[source][-1]
for key, value in settings.items():
    sys.stdout.buffer.write(f"{key}={value}".encode() + b"\0")
PY
)
[[ ${#pg_settings[@]} -ge 5 ]] || die "could not parse PostgreSQL connection settings"
for setting in "${pg_settings[@]}"; do
  key="${setting%%=*}"
  value="${setting#*=}"
  case "$key" in
    PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSSLMODE|PGSSLROOTCERT|PGSSLCERT|PGSSLKEY|PGCONNECT_TIMEOUT|PGAPPNAME|PGTARGETSESSIONATTRS)
      printf -v "$key" '%s' "$value"
      export "$key"
      ;;
    *) die "unexpected PostgreSQL setting" ;;
  esac
done
unset DATABASE_URL pg_settings setting key value

query_scalar() {
  psql --no-password --no-psqlrc --tuples-only --no-align --quiet \
    --set=ON_ERROR_STOP=1 --command "$1" | tr -d '\r' | sed -e '/^[[:space:]]*$/d' | tail -n 1
}

echo "==> Connecting to PostgreSQL and detecting database"
DATABASE_NAME="$(query_scalar 'SELECT current_database();')"
[[ -n "$DATABASE_NAME" ]] || die "database server returned an empty database name"
SERVER_VERSION="$(query_scalar 'SHOW server_version;')"
[[ -n "$SERVER_VERSION" ]] || die "database server returned an empty server version"
PGDATABASE="$DATABASE_NAME"
export PGDATABASE

SAFE_DB_NAME="$(printf '%s' "$DATABASE_NAME" | sed 's/[^A-Za-z0-9_.-]/_/g')"
[[ -n "$SAFE_DB_NAME" ]] || SAFE_DB_NAME=database
STARTED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUT_DIR")"
BACKUP_SET="$OUT_DIR/${SAFE_DB_NAME}_${STAMP}_$$"
mkdir -p "$BACKUP_SET"

DUMP_PATH="$BACKUP_SET/database.dump"
BLOBS_ARCHIVE="$BACKUP_SET/blobs.tar.gz"
UPLOADS_ARCHIVE="$BACKUP_SET/uploads.tar.gz"
MANIFEST_PATH="$BACKUP_SET/manifest.json"

echo "==> Creating one custom-format database dump"
pg_dump --format=custom --no-owner --no-privileges --file "$DUMP_PATH"

echo "==> Archiving blob store"
tar -czf "$BLOBS_ARCHIVE" -C "$(dirname -- "$BLOB_STORE_DIR")" -- "$(basename -- "$BLOB_STORE_DIR")"
echo "==> Archiving uploads"
tar -czf "$UPLOADS_ARCHIVE" -C "$(dirname -- "$UPLOADS_DIR")" -- "$(basename -- "$UPLOADS_DIR")"

for artifact in "$DUMP_PATH" "$BLOBS_ARCHIVE" "$UPLOADS_ARCHIVE"; do
  [[ -s "$artifact" ]] || die "artifact is missing or empty: $artifact"
done

SOURCE_COMMIT="unknown"
if git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SOURCE_COMMIT="$(git -C "$APP_DIR" rev-parse HEAD)"
fi
PG_DUMP_VERSION="$(pg_dump --version | tr -d '\r\n')"
PG_RESTORE_VERSION="$(pg_restore --version | tr -d '\r\n')"
COMPLETED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - "$MANIFEST_PATH" "$STARTED_UTC" "$COMPLETED_UTC" "$DATABASE_NAME" \
  "$SOURCE_COMMIT" "$SERVER_VERSION" "$PG_DUMP_VERSION" "$PG_RESTORE_VERSION" \
  "$BLOB_STORE_DIR" "$UPLOADS_DIR" "$DUMP_PATH" "$BLOBS_ARCHIVE" "$UPLOADS_ARCHIVE" <<'PY'
import hashlib
import json
import os
import sys

(manifest, started, completed, database, commit, server_version,
 dump_version, restore_version, blob_source, upload_source,
 dump_path, blob_archive, upload_archive) = sys.argv[1:]

def artifact(kind, path, source=None):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    result = {
        "kind": kind,
        "path": os.path.abspath(path),
        "size_bytes": os.path.getsize(path),
        "sha256": digest.hexdigest(),
    }
    if source is not None:
        result["source_path"] = os.path.abspath(source)
    return result

document = {
    "format_version": 1,
    "created_utc": started,
    "completed_utc": completed,
    "method": "pg_dump custom format plus gzip-compressed tar archives",
    "database_name": database,
    "source_commit": commit,
    "postgres": {
        "server_version": server_version,
        "pg_dump_version": dump_version,
        "pg_restore_version": restore_version,
    },
    "artifacts": [
        artifact("postgres_custom_dump", dump_path),
        artifact("blob_archive", blob_archive, blob_source),
        artifact("uploads_archive", upload_archive, upload_source),
    ],
    "validation": {
        "archive_status": "pending",
        "restore_status": "pending",
        "verified": False,
        "verified_utc": None,
    },
}
temporary = manifest + ".tmp"
with open(temporary, "w", encoding="utf-8") as stream:
    json.dump(document, stream, indent=2, sort_keys=True)
    stream.write("\n")
os.replace(temporary, manifest)
PY

if [[ -n "${VERIFY_SCRIPT:-}" ]]; then
  VERIFY_SCRIPT_PATH="$VERIFY_SCRIPT"
elif [[ -x "$SCRIPT_DIR/verify-backup.sh" ]]; then
  VERIFY_SCRIPT_PATH="$SCRIPT_DIR/verify-backup.sh"
else
  VERIFY_SCRIPT_PATH="/usr/local/bin/deed-erp-verify-backup.sh"
fi
[[ -x "$VERIFY_SCRIPT_PATH" ]] || die "backup verifier is not executable: $VERIFY_SCRIPT_PATH"

echo "==> Validating dump, archives, checksums, and manifest"
if [[ "$BACKUP_RESTORE_MODE" == "restore" ]]; then
  "$VERIFY_SCRIPT_PATH" --restore "$MANIFEST_PATH"
else
  "$VERIFY_SCRIPT_PATH" --skip-restore "$MANIFEST_PATH"
fi

python3 - "$MANIFEST_PATH" <<'PY' || die "verifier did not mark backup as verified"
import json, sys
validation = json.load(open(sys.argv[1], encoding="utf-8"))["validation"]
raise SystemExit(0 if validation.get("verified") is True and validation.get("restore_status") == "success" else 1)
PY

if [[ -n "$BACKUP_RESULT_FILE" ]]; then
  printf '%s\n' "$MANIFEST_PATH" >"$BACKUP_RESULT_FILE"
  chmod 600 "$BACKUP_RESULT_FILE"
fi
printf 'VERIFIED BACKUP: %s\n' "$MANIFEST_PATH"
