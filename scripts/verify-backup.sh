#!/usr/bin/env bash
# Validate a Deed ERP backup set and optionally prove it with an isolated restore.
set -Eeuo pipefail
set +x
umask 077

APP_DIR="${APP_DIR:-/var/www/deed-erp}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
MODE=restore
MANIFEST=
TEMP_DATABASE=
TEMP_CREATED=0
VALIDATION_STARTED=0

usage() {
  cat <<'EOF'
Usage: verify-backup.sh [--restore|--skip-restore] MANIFEST

Checks every manifest size and SHA-256, runs pg_restore --list on the custom
dump, and lists both tar archives. --restore (the default) then creates an
isolated empty temporary database, restores into it, checks the connection,
and drops it.

--skip-restore records "skipped", leaves verified=false, and exits nonzero.
DATABASE_URL may be supplied through the environment or ENV_FILE when the
PGHOST/PGDATABASE libpq variables are not already present.
EOF
}

die() {
  printf 'VERIFICATION FAILED: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restore) MODE=restore ;;
    --skip-restore) MODE=skip ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*) die "unknown option: $1" ;;
    *)
      [[ -z "$MANIFEST" ]] || die "only one manifest may be specified"
      MANIFEST="$1"
      ;;
  esac
  shift
done
[[ -n "$MANIFEST" ]] || die "manifest path is required"
[[ -f "$MANIFEST" ]] || die "manifest does not exist: $MANIFEST"
MANIFEST="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$MANIFEST")"

for command in python3 sha256sum stat pg_restore tar; do
  command -v "$command" >/dev/null 2>&1 || die "required command not found: $command"
done

mark_validation() {
  local archive_status="$1" restore_status="$2" verified="$3" detail="${4:-}"
  python3 - "$MANIFEST" "$archive_status" "$restore_status" "$verified" "$detail" <<'PY'
import datetime
import json
import os
import sys

manifest, archive_status, restore_status, verified, detail = sys.argv[1:]
with open(manifest, encoding="utf-8") as stream:
    document = json.load(stream)
validation = document.setdefault("validation", {})
validation.update({
    "archive_status": archive_status,
    "restore_status": restore_status,
    "verified": verified == "true",
    "verified_utc": (
        datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        if verified == "true" else None
    ),
})
if detail:
    validation["detail"] = detail
else:
    validation.pop("detail", None)
temporary = manifest + ".tmp"
with open(temporary, "w", encoding="utf-8") as stream:
    json.dump(document, stream, indent=2, sort_keys=True)
    stream.write("\n")
os.replace(temporary, manifest)
PY
}

cleanup() {
  local status=$?
  set +e
  trap - ERR
  if [[ "$TEMP_CREATED" == 1 ]]; then
    dropdb --if-exists --maintenance-db="$PGDATABASE" "$TEMP_DATABASE" >/dev/null 2>&1
    [[ $? == 0 ]] || status=1
    TEMP_CREATED=0
  fi
  if [[ $status -ne 0 && "$VALIDATION_STARTED" == 1 ]]; then
    mark_validation failed failed false "Validation or isolated restore failed; inspect verifier output." >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

# Validate structure before trusting paths from the manifest.
mapfile -d '' -t artifact_data < <(python3 - "$MANIFEST" <<'PY'
import json
import os
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    document = json.load(stream)
if document.get("format_version") != 1:
    raise SystemExit("unsupported manifest format")
artifacts = document.get("artifacts")
if not isinstance(artifacts, list):
    raise SystemExit("manifest artifacts are missing")
by_kind = {item.get("kind"): item for item in artifacts if isinstance(item, dict)}
required = ("postgres_custom_dump", "blob_archive", "uploads_archive")
if set(by_kind) != set(required):
    raise SystemExit("manifest must contain exactly the database, blob, and uploads artifacts")
for kind in required:
    item = by_kind[kind]
    path = item.get("path")
    size = item.get("size_bytes")
    digest = item.get("sha256")
    if not isinstance(path, str) or not os.path.isabs(path):
        raise SystemExit(f"{kind} path must be absolute")
    if not isinstance(size, int) or size <= 0:
        raise SystemExit(f"{kind} size is invalid")
    if not isinstance(digest, str) or len(digest) != 64:
        raise SystemExit(f"{kind} SHA-256 is invalid")
    for value in (kind, path, str(size), digest):
        sys.stdout.buffer.write(value.encode() + b"\0")
PY
)
[[ ${#artifact_data[@]} == 12 ]] || die "manifest artifact data is incomplete"
VALIDATION_STARTED=1

DUMP_PATH=
BLOB_ARCHIVE=
UPLOADS_ARCHIVE=
for ((index=0; index<${#artifact_data[@]}; index+=4)); do
  kind="${artifact_data[index]}"
  path="${artifact_data[index+1]}"
  expected_size="${artifact_data[index+2]}"
  expected_sha="${artifact_data[index+3]}"
  [[ -f "$path" ]] || die "artifact is missing: $path"
  actual_size="$(stat -c '%s' "$path")"
  [[ "$actual_size" == "$expected_size" ]] || die "size mismatch for $path"
  actual_sha="$(sha256sum "$path")"
  actual_sha="${actual_sha%% *}"
  [[ "$actual_sha" == "$expected_sha" ]] || die "SHA-256 mismatch for $path"
  case "$kind" in
    postgres_custom_dump) DUMP_PATH="$path" ;;
    blob_archive) BLOB_ARCHIVE="$path" ;;
    uploads_archive) UPLOADS_ARCHIVE="$path" ;;
  esac
done
unset artifact_data kind path expected_size expected_sha actual_size actual_sha index

echo "==> Validating custom dump directory"
pg_restore --list "$DUMP_PATH" >/dev/null
echo "==> Validating filesystem archives"
tar -tzf "$BLOB_ARCHIVE" >/dev/null
tar -tzf "$UPLOADS_ARCHIVE" >/dev/null
mark_validation success pending false

if [[ "$MODE" == skip ]]; then
  mark_validation success skipped false "Isolated restore was explicitly skipped."
  echo "NOT VERIFIED: archive checks passed, but isolated restore was skipped" >&2
  VALIDATION_STARTED=0
  trap - EXIT
  exit 2
fi

for command in psql createdb dropdb; do
  command -v "$command" >/dev/null 2>&1 || die "required restore command not found: $command"
done

if [[ -z "${PGDATABASE:-}" ]]; then
  mapfile -d '' -t pg_settings < <(
    DATABASE_URL="${DATABASE_URL:-}" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import ast
import os
import re
import sys
from urllib.parse import parse_qs, unquote, urlsplit

url = os.environ.get("DATABASE_URL", "")
if not url:
    try:
        lines = open(os.environ["ENV_FILE"], encoding="utf-8").read().splitlines()
    except OSError as exc:
        raise SystemExit(f"cannot read DATABASE_URL from ENV_FILE: {exc}")
    for line in lines:
        match = re.match(r"^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$", line)
        if match:
            value = match.group(1)
            if value[:1] in {"'", '"'}:
                value = ast.literal_eval(value)
            else:
                value = value.split(" #", 1)[0].strip()
            url = value
            break
if not url:
    raise SystemExit("DATABASE_URL is unavailable")
parsed = urlsplit(url)
if parsed.scheme not in {"postgres", "postgresql"} or not parsed.path.strip("/"):
    raise SystemExit("DATABASE_URL is not a PostgreSQL URL with a database")
values = {
    "PGHOST": parsed.hostname or "",
    "PGPORT": str(parsed.port or 5432),
    "PGUSER": unquote(parsed.username or ""),
    "PGPASSWORD": unquote(parsed.password or ""),
    "PGDATABASE": unquote(parsed.path.lstrip("/")),
}
mapping = {
    "sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT",
    "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY",
    "connect_timeout": "PGCONNECT_TIMEOUT",
}
query = parse_qs(parsed.query, keep_blank_values=True)
for source, target in mapping.items():
    if source in query:
        values[target] = query[source][-1]
for key, value in values.items():
    sys.stdout.buffer.write(f"{key}={value}".encode() + b"\0")
PY
  )
  [[ ${#pg_settings[@]} -ge 5 ]] || die "could not configure PostgreSQL restore connection"
  for setting in "${pg_settings[@]}"; do
    key="${setting%%=*}"
    value="${setting#*=}"
    case "$key" in
      PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSSLMODE|PGSSLROOTCERT|PGSSLCERT|PGSSLKEY|PGCONNECT_TIMEOUT)
        printf -v "$key" '%s' "$value"
        export "$key"
        ;;
      *) die "unexpected PostgreSQL setting" ;;
    esac
  done
  unset DATABASE_URL pg_settings setting key value
fi

ORIGINAL_DATABASE="$PGDATABASE"
TEMP_DATABASE="deed_verify_$(date -u +%Y%m%d%H%M%S)_$$_${RANDOM}"
TEMP_DATABASE="${TEMP_DATABASE:0:63}"
[[ "$TEMP_DATABASE" != "$ORIGINAL_DATABASE" ]] || die "temporary database name collides with source"

echo "==> Performing isolated restore into temporary database"
createdb --maintenance-db="$ORIGINAL_DATABASE" "$TEMP_DATABASE"
TEMP_CREATED=1
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$TEMP_DATABASE" "$DUMP_PATH"
RESTORED_DATABASE="$(
  PGDATABASE="$TEMP_DATABASE" psql --no-password --no-psqlrc --tuples-only --no-align --quiet \
    --set=ON_ERROR_STOP=1 --command 'SELECT current_database();' | tr -d '[:space:]'
)"
[[ "$RESTORED_DATABASE" == "$TEMP_DATABASE" ]] || die "temporary restore connection check failed"
dropdb --maintenance-db="$ORIGINAL_DATABASE" "$TEMP_DATABASE"
TEMP_CREATED=0

mark_validation success success true
VALIDATION_STARTED=0
trap - EXIT
echo "VERIFIED: checksums, archive structure, dump listing, and isolated restore succeeded"
