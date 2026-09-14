#!/usr/bin/env bash
# Focused integration tests for backup verification and deployment rollback.
set -Eeuo pipefail
set +x

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  printf 'TEST FAILED: %s\n' "$*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1" expected="$2"
  grep -Fq -- "$expected" "$file" || fail "$file does not contain: $expected"
}

assert_file_not_contains() {
  local file="$1" unexpected="$2"
  if grep -Fq -- "$unexpected" "$file"; then
    fail "$file contains sensitive/unexpected text: $unexpected"
  fi
}

test_backup_and_verifier() {
  local fixture="$TMP_ROOT/backup"
  mkdir -p "$fixture/bin" "$fixture/app/.uploads" "$fixture/blobs" "$fixture/output"
  printf 'blob\n' >"$fixture/blobs/blob.txt"
  printf 'upload\n' >"$fixture/app/.uploads/upload.txt"
  printf 'test\n' >"$fixture/app/source.txt"

  cat >"$fixture/bin/psql" <<'EOF'
#!/usr/bin/env bash
command_log="${TEST_COMMAND_LOG:-$(dirname "$0")/../commands.log}"
printf 'psql %s\n' "$*" >>"$command_log"
case "$*" in
  *"SELECT current_database();"*)
    database="${PGDATABASE:-actual-production}"
    for argument in "$@"; do
      [[ "$argument" != --dbname=* ]] || database="${argument#--dbname=}"
    done
    printf '%s\n' "$database"
    ;;
  *"SHOW server_version;"*)
    printf '16.4\n'
    ;;
esac
EOF
  cat >"$fixture/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
command_log="${TEST_COMMAND_LOG:-$(dirname "$0")/../commands.log}"
printf 'pg_dump %s\n' "$*" >>"$command_log"
if [[ "${1:-}" == "--version" ]]; then
  printf 'pg_dump (PostgreSQL) 16.4\n'
  exit 0
fi
output=
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --file ]]; then
    output="$2"
    shift
  fi
  shift
done
printf 'custom dump fixture\n' >"$output"
EOF
  cat >"$fixture/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
command_log="${TEST_COMMAND_LOG:-$(dirname "$0")/../commands.log}"
printf 'pg_restore %s\n' "$*" >>"$command_log"
if [[ "${1:-}" == "--version" ]]; then
  printf 'pg_restore (PostgreSQL) 16.4\n'
elif [[ "${1:-}" == "--list" ]]; then
  printf 'fixture archive list\n'
elif [[ "${PG_RESTORE_FAIL:-0}" == 1 ]]; then
  exit 1
else
  dump_path="${!#}"
  if [[ "$dump_path" == /var/tmp/deed-erp-verify.*/database.dump ]]; then
    printf 'restore-env PGUSER=%s PGPASSWORD=%s DATABASE_URL=%s PGDATABASE=%s\n' \
      "${PGUSER:-unset}" "${PGPASSWORD:-unset}" "${DATABASE_URL:-unset}" \
      "${PGDATABASE:-unset}" >>"$command_log"
    printf 'restore-dump %s uid=%s mode=%s\n' "$dump_path" \
      "$(stat -c '%u' "$dump_path")" "$(stat -c '%a' "$dump_path")" >>"$command_log"
  fi
fi
EOF
  cat >"$fixture/bin/createdb" <<'EOF'
#!/usr/bin/env bash
command_log="${TEST_COMMAND_LOG:-$(dirname "$0")/../commands.log}"
printf 'createdb %s\n' "$*" >>"$command_log"
if [[ "${PGDATABASE:-}" == postgres ]]; then
  printf 'createdb-env PGHOST=%s PGPORT=%s PGUSER=%s PGPASSWORD=%s DATABASE_URL=%s\n' \
    "${PGHOST:-unset}" "${PGPORT:-unset}" "${PGUSER:-unset}" \
    "${PGPASSWORD:-unset}" "${DATABASE_URL:-unset}" >>"$command_log"
fi
EOF
  cat >"$fixture/bin/dropdb" <<'EOF'
#!/usr/bin/env bash
command_log="${TEST_COMMAND_LOG:-$(dirname "$0")/../commands.log}"
printf 'dropdb %s\n' "$*" >>"$command_log"
EOF
  chmod +x "$fixture/bin/"*

  local command_log="$fixture/commands.log"
  local output_log="$fixture/output.log"
  local result_file="$fixture/result"
  TEST_COMMAND_LOG="$command_log" \
    PATH="$fixture/bin:$PATH" \
    DATABASE_URL='postgresql://backup-user:very-secret-password@db.example/actual-production?sslmode=require' \
    APP_DIR="$fixture/app" \
    BLOB_STORE_DIR="$fixture/blobs" \
    UPLOADS_DIR="$fixture/app/.uploads" \
    VERIFY_SCRIPT="$ROOT/scripts/verify-backup.sh" \
    BACKUP_RESULT_FILE="$result_file" \
    "$ROOT/scripts/backup-db.sh" "$fixture/output" >"$output_log" 2>&1

  local manifest
  manifest="$(sed -n '1p' "$result_file")"
  [[ -f "$manifest" ]] || fail "backup did not create a manifest"
  python3 - "$manifest" <<'PY' || fail "manifest is not successfully verified"
import json
import sys
document = json.load(open(sys.argv[1], encoding="utf-8"))
assert document["database_name"] == "actual-production"
assert document["method"] == "pg_dump custom format plus gzip-compressed tar archives"
assert len(document["artifacts"]) == 3
assert document["validation"]["archive_status"] == "success"
assert document["validation"]["restore_status"] == "success"
assert document["validation"]["verified"] is True
PY
  [[ "$(grep -c '^pg_dump --format=custom' "$command_log")" == 1 ]] ||
    fail "backup did not produce exactly one custom pg_dump"
  assert_file_not_contains "$command_log" "very-secret-password"
  assert_file_not_contains "$command_log" "postgresql://"
  assert_file_not_contains "$output_log" "very-secret-password"
  assert_file_not_contains "$output_log" "postgresql://"

  local postgres_uid copied_dump
  id postgres >/dev/null 2>&1 || fail "postgres OS user is required for root restore test"
  sudo -n true >/dev/null 2>&1 || fail "passwordless sudo is required for root restore test"
  postgres_uid="$(id -u postgres)"
  chmod 755 "$TMP_ROOT" "$fixture" "$fixture/bin"
  chmod 700 "$(dirname "$manifest")"
  touch "$command_log"
  chmod 666 "$command_log"
  local root_restore_log="$fixture/root-restore.log"
  if ! sudo -n env PATH="$fixture/bin:$PATH" PGHOST=localhost PGDATABASE=actual-production \
    PGUSER=application-role PGPASSWORD=production-password \
    DATABASE_URL='postgresql://application-role:production-password@localhost/actual-production' \
    _BACKUP_RESTORE_SAFE_PATH="$fixture/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    "$ROOT/scripts/verify-backup.sh" --restore "$manifest" >"$root_restore_log" 2>&1; then
    sed 's/production-password/[REDACTED]/g' "$root_restore_log" >&2
    fail "automatic root-to-postgres restore failed"
  fi
  sudo -n chown "$(id -u):$(id -g)" "$manifest"
  chmod 600 "$manifest"

  if ! sudo -n env PATH="$fixture/bin:$PATH" PGHOST=/var/run/postgresql \
    PGPORT=5432 PGDATABASE=actual-production PGUSER=application-role \
    PGPASSWORD=production-password \
    DATABASE_URL='postgresql://application-role:production-password@localhost/actual-production' \
    BACKUP_RESTORE_OS_USER=postgres \
    _BACKUP_RESTORE_SAFE_PATH="$fixture/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    "$ROOT/scripts/verify-backup.sh" --restore "$manifest" >"$root_restore_log" 2>&1; then
    sed 's/production-password/[REDACTED]/g' "$root_restore_log" >&2
    fail "explicit BACKUP_RESTORE_OS_USER restore failed"
  fi
  sudo -n chown "$(id -u):$(id -g)" "$manifest"
  chmod 600 "$manifest"

  assert_file_contains "$command_log" \
    "restore-env PGUSER=unset PGPASSWORD=unset DATABASE_URL=unset PGDATABASE=postgres"
  assert_file_contains "$command_log" \
    "createdb-env PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=unset PGPASSWORD=unset DATABASE_URL=unset"
  copied_dump="$(sed -n 's/^restore-dump \([^ ]*\) uid=.*/\1/p' "$command_log" | tail -n 1)"
  [[ "$copied_dump" == /var/tmp/deed-erp-verify.*/database.dump ]] ||
    fail "OS-user restore did not use a private temporary dump copy"
  assert_file_contains "$command_log" "restore-dump $copied_dump uid=$postgres_uid mode=600"
  [[ ! -e "$copied_dump" ]] || fail "temporary OS-user dump copy was not deleted"

  if TEST_COMMAND_LOG="$command_log" PATH="$fixture/bin:$PATH" \
    "$ROOT/scripts/verify-backup.sh" --skip-restore "$manifest" >/dev/null 2>&1; then
    fail "skip-restore unexpectedly succeeded"
  fi
  python3 - "$manifest" <<'PY' || fail "skipped restore was incorrectly marked"
import json
import sys
validation = json.load(open(sys.argv[1], encoding="utf-8"))["validation"]
assert validation["archive_status"] == "success"
assert validation["restore_status"] == "skipped"
assert validation["verified"] is False
PY

  if TEST_COMMAND_LOG="$command_log" PATH="$fixture/bin:$PATH" \
    PGDATABASE=actual-production PG_RESTORE_FAIL=1 \
    "$ROOT/scripts/verify-backup.sh" --restore "$manifest" >/dev/null 2>&1; then
    fail "failed isolated restore unexpectedly succeeded"
  fi
  python3 - "$manifest" <<'PY' || fail "failed restore was incorrectly marked"
import json
import sys
validation = json.load(open(sys.argv[1], encoding="utf-8"))["validation"]
assert validation["restore_status"] == "failed"
assert validation["verified"] is False
PY

  rm -rf "$fixture/app/.uploads"
  if TEST_COMMAND_LOG="$command_log" PATH="$fixture/bin:$PATH" \
    DATABASE_URL='postgresql://user:secret@db.example/actual-production' \
    APP_DIR="$fixture/app" BLOB_STORE_DIR="$fixture/blobs" \
    UPLOADS_DIR="$fixture/app/.uploads" VERIFY_SCRIPT="$ROOT/scripts/verify-backup.sh" \
    "$ROOT/scripts/backup-db.sh" "$fixture/output" >/dev/null 2>&1; then
    fail "backup succeeded with a missing uploads directory"
  fi
}

make_deploy_fixture() {
  local fixture="$1"
  mkdir -p "$fixture/bin" "$fixture/seed"
  git -C "$fixture/seed" init -q
  git -C "$fixture/seed" config user.name Test
  git -C "$fixture/seed" config user.email test@example.invalid
  printf '.env\n.next/\n.next-*\n' >"$fixture/seed/.gitignore"
  printf 'old\n' >"$fixture/seed/version.txt"
  printf 'reference next\n' >"$fixture/seed/next-env.d.ts"
  printf '{}\n' >"$fixture/seed/tsconfig.json"
  printf 'module.exports = {}\n' >"$fixture/seed/ecosystem.config.js"
  git -C "$fixture/seed" add .
  git -C "$fixture/seed" commit -qm old
  git clone -q --bare "$fixture/seed" "$fixture/remote.git"
  git clone -q "$fixture/remote.git" "$fixture/app"
  git -C "$fixture/app" config user.name Test
  git -C "$fixture/app" config user.email test@example.invalid
  git -C "$fixture/app" branch -M master
  git -C "$fixture/seed" branch -M master
  git -C "$fixture/seed" remote add origin "$fixture/remote.git"
  printf 'new\n' >"$fixture/seed/version.txt"
  printf 'target\n' >"$fixture/seed/target.txt"
  git -C "$fixture/seed" add .
  git -C "$fixture/seed" commit -qm target
  git -C "$fixture/seed" push -q origin master
  printf 'DATABASE_URL=postgresql://user:secret@db/prod\n' >"$fixture/app/.env"
  mkdir -p "$fixture/app/.next"
  printf 'old build\n' >"$fixture/app/.next/build.txt"

  cat >"$fixture/bin/backup" <<'EOF'
#!/usr/bin/env bash
manifest="$TEST_DEPLOY_FIXTURE/manifest.json"
printf '{"validation":{"verified":true,"restore_status":"success"}}\n' >"$manifest"
printf '%s\n' "$manifest" >"$BACKUP_RESULT_FILE"
EOF
  cat >"$fixture/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
printf 'DATABASE_URL=postgresql://user:log-secret@db/prod\n'
if [[ "${1:-}" == build ]]; then
  mkdir -p .next-staging
  printf 'new build\n' >.next-staging/build.txt
fi
EOF
  cat >"$fixture/bin/pm2" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == startOrReload ]]; then
  count=0
  [[ ! -f "$TEST_DEPLOY_FIXTURE/pm2-count" ]] || count="$(<"$TEST_DEPLOY_FIXTURE/pm2-count")"
  count=$((count + 1))
  printf '%s\n' "$count" >"$TEST_DEPLOY_FIXTURE/pm2-count"
  if [[ "$TEST_FAILURE_MODE" == reload && "$count" == 1 ]]; then
    exit 1
  fi
fi
EOF
  cat >"$fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '500'
EOF
  chmod +x "$fixture/bin/"*
}

test_deploy_rollback() {
  local mode="$1"
  local fixture="$TMP_ROOT/deploy-$mode"
  make_deploy_fixture "$fixture"
  local old_commit
  old_commit="$(git -C "$fixture/app" rev-parse HEAD)"

  if TEST_DEPLOY_FIXTURE="$fixture" TEST_FAILURE_MODE="$mode" \
    PATH="$fixture/bin:$PATH" APP_DIR="$fixture/app" \
    ENV_FILE="$fixture/app/.env" BACKUP_COMMAND="$fixture/bin/backup" \
    DEPLOY_LOG="$fixture/deploy.log" ROLLBACK_STATE_DIR="$fixture/rollback" \
    HEALTH_ATTEMPTS=1 HEALTH_INTERVAL=1 \
    "$ROOT/scripts/deploy/deed-erp-deploy.sh" >/dev/null 2>&1; then
    fail "$mode failure deployment unexpectedly succeeded"
  fi

  [[ "$(git -C "$fixture/app" rev-parse HEAD)" == "$old_commit" ]] ||
    fail "$mode failure did not restore the previous source commit"
  assert_file_contains "$fixture/app/version.txt" "old"
  [[ ! -e "$fixture/app/target.txt" ]] || fail "$mode failure left target source active"
  assert_file_contains "$fixture/app/.next/build.txt" "old build"
  assert_file_contains "$fixture/deploy.log" "ROLLBACK OK"
  assert_file_not_contains "$fixture/deploy.log" "log-secret"
  assert_file_not_contains "$fixture/deploy.log" "postgresql://user:"
}

test_deploy_restores_next_generated_dirt() {
  local fixture="$TMP_ROOT/deploy-next-dirt"
  make_deploy_fixture "$fixture"
  printf 'rewritten by next build\n' >"$fixture/app/next-env.d.ts"
  printf '{"include":[".next-staging/types/**/*.ts"]}\n' >"$fixture/app/tsconfig.json"
  mkdir -p "$fixture/app/.next-previous"
  printf 'previous build\n' >"$fixture/app/.next-previous/build.txt"

  if TEST_DEPLOY_FIXTURE="$fixture" TEST_FAILURE_MODE=health \
    PATH="$fixture/bin:$PATH" APP_DIR="$fixture/app" \
    ENV_FILE="$fixture/app/.env" BACKUP_COMMAND="$fixture/bin/backup" \
    DEPLOY_LOG="$fixture/deploy.log" ROLLBACK_STATE_DIR="$fixture/rollback" \
    HEALTH_ATTEMPTS=1 HEALTH_INTERVAL=1 \
    "$ROOT/scripts/deploy/deed-erp-deploy.sh" >/dev/null 2>&1; then
    fail "health-failure deploy unexpectedly succeeded"
  fi

  assert_file_not_contains "$fixture/deploy.log" "refusing to overwrite local changes"
  assert_file_contains "$fixture/deploy.log" "=== Deploy started"
  assert_file_contains "$fixture/app/next-env.d.ts" "reference next"
  assert_file_contains "$fixture/app/tsconfig.json" "{}"
}

test_deploy_script_uses_github_ssh_over_443() {
  assert_file_contains "$ROOT/scripts/deploy/deed-erp-deploy.sh" "ssh.github.com"
  assert_file_contains "$ROOT/scripts/deploy/deed-erp-deploy.sh" "ConnectTimeout=15"
}

test_backup_and_verifier
test_deploy_rollback reload
test_deploy_rollback health
test_deploy_restores_next_generated_dirt
test_deploy_script_uses_github_ssh_over_443
printf 'Production safety tests passed\n'
