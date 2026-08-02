#!/usr/bin/env bash
# Fail-closed Deed ERP production deployment with automatic source/build rollback.
set -Eeuo pipefail
set +x
umask 077

APP_DIR="${APP_DIR:-/var/www/deed-erp}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
LOG="${DEPLOY_LOG:-/var/log/deed-erp-deploy.log}"
BACKUP_COMMAND="${BACKUP_COMMAND:-/usr/local/bin/deed-erp-backup.sh}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-master}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/login}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-24}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
ROLLBACK_STATE_DIR="${ROLLBACK_STATE_DIR:-/var/lib/deed-erp/deploy-rollback}"
PREVIOUS_BUILD_PATH="$APP_DIR/.next-previous"
STAGED_BUILD_PATH="$APP_DIR/.next-staging"

SOURCE_SYNCED=0
BUILD_SWAPPED=0
HAD_PREVIOUS_BUILD=0
PREVIOUS_COMMIT=
BACKUP_RESULT_FILE=

usage() {
  cat <<'EOF'
Usage: deed-erp-deploy.sh

Creates a verified pre-deploy backup, syncs and stages a build, reloads PM2,
and rolls source/build back automatically if deployment fails.

Configuration:
  APP_DIR              Application worktree (/var/www/deed-erp)
  ENV_FILE             Production environment file (APP_DIR/.env)
  BACKUP_COMMAND       Installed backup command
  DEPLOY_REMOTE        Git remote (origin)
  DEPLOY_BRANCH        Git branch (master)
  HEALTH_URL           Local health URL (http://localhost:3000/login)
  HEALTH_ATTEMPTS      Number of checks (24)
  HEALTH_INTERVAL      Seconds between checks (5)
  ROLLBACK_STATE_DIR   Persistent rollback metadata directory

For the required verified backup, root deployments against local PostgreSQL
automatically restore as OS user "postgres". BACKUP_RESTORE_OS_USER can select
another local OS account or "credential" to force the application credentials.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
[[ $# == 0 ]] || {
  printf 'This command accepts no arguments; see --help.\n' >&2
  exit 1
}

mkdir -p "$(dirname -- "$LOG")"
touch "$LOG"
chmod 600 "$LOG"
# Redact connection credentials and common secret assignments even if a child
# process unexpectedly prints one. Deployment code does not intentionally echo
# the environment or DATABASE_URL.
exec > >(
  sed -u -E \
    -e 's#([A-Za-z][A-Za-z0-9+.-]*://[^:/[:space:]@]+):[^@[:space:]]+@#\1:[REDACTED]@#g' \
    -e 's#((DATABASE_URL|PASSWORD|PASS|TOKEN|SECRET|API_KEY)[[:space:]]*=[[:space:]]*)[^[:space:]]+#\1[REDACTED]#Ig' \
    -e 's#([?&](password|pass|token|secret|key)=)[^&[:space:]]+#\1[REDACTED]#Ig' |
    tee -a "$LOG"
) 2>&1

log() {
  printf '%s\n' "$*"
}

deploy_failed() {
  local status="$1" line="$2"
  trap - ERR
  set +e
  log "DEPLOY FAILED at line $line (status $status)"

  if [[ "$SOURCE_SYNCED" == 1 ]]; then
    log "--- Restoring previous source commit $PREVIOUS_COMMIT"
    git reset --hard "$PREVIOUS_COMMIT"

    if [[ "$BUILD_SWAPPED" == 1 ]]; then
      log "--- Restoring previous production build"
      rm -rf -- "$APP_DIR/.next"
      if [[ "$HAD_PREVIOUS_BUILD" == 1 && -d "$PREVIOUS_BUILD_PATH" ]]; then
        mv -- "$PREVIOUS_BUILD_PATH" "$APP_DIR/.next"
      fi
    fi
    rm -rf -- "$STAGED_BUILD_PATH"

    log "--- Restarting restored source/build (database is untouched)"
    if pm2 startOrReload ecosystem.config.js --update-env && pm2 save; then
      log "ROLLBACK OK: previous source/build restarted"
    else
      log "ROLLBACK ERROR: source/build restored on disk, but PM2 restart failed"
    fi
  else
    log "No source sync occurred; rollback was not required"
  fi
  [[ -z "$BACKUP_RESULT_FILE" ]] || rm -f -- "$BACKUP_RESULT_FILE"
  exit "$status"
}
trap 'deploy_failed "$?" "$LINENO"' ERR

for command in git pnpm pm2 curl python3 mktemp sed tee; do
  command -v "$command" >/dev/null 2>&1 || {
    log "Required command not found: $command"
    exit 1
  }
done
[[ -x "$BACKUP_COMMAND" ]] || {
  log "Backup command is not executable: $BACKUP_COMMAND"
  exit 1
}
[[ -d "$APP_DIR/.git" || -f "$APP_DIR/.git" ]] || {
  log "Application directory is not a Git worktree: $APP_DIR"
  exit 1
}
[[ -f "$ENV_FILE" ]] || {
  log "Production environment file is missing: $ENV_FILE"
  exit 1
}
[[ -d "$APP_DIR/.next" ]] || {
  log "Current production build is missing: $APP_DIR/.next"
  exit 1
}
[[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ && "$HEALTH_INTERVAL" =~ ^[1-9][0-9]*$ ]] || {
  log "Health attempts and interval must be positive integers"
  exit 1
}
[[ "$HEALTH_URL" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/ ]] || {
  log "HEALTH_URL must use localhost or 127.0.0.1 without credentials"
  exit 1
}

cd "$APP_DIR"
# Ops push workflows sometimes leave copied helpers under scripts/. Restore or
# remove only those known paths so a deploy is not blocked — never wipe .env,
# uploads, or unrelated local edits.
OPS_PATHS=(
  scripts/book-leave-for-employee.mjs
  scripts/add-product-serial.mjs
  scripts/heal-delivery-qty.mjs
  scripts/revert-hollow-done-delivery.mjs
  scripts/detect-hollow-done-deliveries.mjs
  scripts/purge-explore-test-data.mjs
  scripts/add-opening-bulk-stock.mjs
  scripts/heal-grn-serials.mjs
  scripts/mark-serials-sold.mjs
  scripts/find-serials.mjs
  ops/mark-serials-sold-request.json
  ops/find-serials-request.json
  ops/heal-grn-serials-request.json
  ops/add-serial-request.json
  ops/add-opening-bulk-stock-request.json
  ops/purge-explore-test-request.json
  ops/heal-delivery-qty-request.json
  ops/revert-hollow-done-request.json
  ops/book-leave-request.json
  ops/clean-worktree-request.json
)
for ops_path in "${OPS_PATHS[@]}"; do
  if git ls-files --error-unmatch "$ops_path" >/dev/null 2>&1; then
    git restore --source=HEAD --worktree --staged -- "$ops_path" 2>/dev/null \
      || git checkout HEAD -- "$ops_path" 2>/dev/null \
      || true
  elif [[ -e "$ops_path" ]]; then
    log "Removing untracked ops copy before deploy: $ops_path"
    rm -f -- "$ops_path"
  fi
done
rm -rf -- "$STAGED_BUILD_PATH"
[[ -z "$(git status --porcelain --untracked-files=normal -- . \
  ':(exclude).next-previous' ':(exclude).next-staging')" ]] || {
  log "Application worktree is dirty; refusing to overwrite local changes"
  git status --porcelain || true
  exit 1
}
PREVIOUS_COMMIT="$(git rev-parse HEAD)"

log "=== Deploy started $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
log "--- Creating and proving pre-deploy backup"
BACKUP_RESULT_FILE="$(mktemp)"
chmod 600 "$BACKUP_RESULT_FILE"
APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" BACKUP_RESULT_FILE="$BACKUP_RESULT_FILE" \
  "$BACKUP_COMMAND"
VERIFIED_MANIFEST="$(sed -n '1p' "$BACKUP_RESULT_FILE")"
[[ -n "$VERIFIED_MANIFEST" && -f "$VERIFIED_MANIFEST" ]] || {
  log "Backup command did not return a manifest"
  exit 1
}
python3 - "$VERIFIED_MANIFEST" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as stream:
    validation = json.load(stream).get("validation", {})
if validation.get("verified") is not True or validation.get("restore_status") != "success":
    raise SystemExit("backup manifest is not verified by an isolated restore")
PY
log "Verified backup manifest: $VERIFIED_MANIFEST"

log "--- Recording rollback state"
mkdir -p "$ROLLBACK_STATE_DIR"
printf '%s\n' "$PREVIOUS_COMMIT" >"$ROLLBACK_STATE_DIR/previous-commit"
printf '%s\n' "$VERIFIED_MANIFEST" >"$ROLLBACK_STATE_DIR/pre-deploy-backup-manifest"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$ROLLBACK_STATE_DIR/deploy-started-utc"

log "--- Syncing source to $DEPLOY_REMOTE/$DEPLOY_BRANCH"
GIT_TERMINAL_PROMPT=0 git fetch "$DEPLOY_REMOTE" "$DEPLOY_BRANCH"
SOURCE_SYNCED=1
git checkout -B "$DEPLOY_BRANCH" "$DEPLOY_REMOTE/$DEPLOY_BRANCH"
git log --oneline -1

log "--- Installing locked dependencies"
pnpm install --frozen-lockfile

log "--- Building into staging while current .next remains live"
rm -rf -- "$STAGED_BUILD_PATH"
NEXT_DIST_DIR=.next-staging pnpm build
if [[ ! -d "$STAGED_BUILD_PATH" ]]; then
  log "Build completed without producing $STAGED_BUILD_PATH"
  deploy_failed 1 "$LINENO"
fi

# The script's umask 077 protects logs and temp files, but it also makes the
# staged build root-only (700/600). Nginx serves /_next/static/ directly from
# .next as www-data, so an unreadable build breaks every stylesheet and script
# with 404/403 after the swap. Re-open the build for read before it goes live.
log "--- Making staged build readable for the nginx static file server"
chmod -R u=rwX,go=rX -- "$STAGED_BUILD_PATH"

log "--- Swapping build and retaining previous .next for rollback"
rm -rf -- "$PREVIOUS_BUILD_PATH"
mv -- "$APP_DIR/.next" "$PREVIOUS_BUILD_PATH"
HAD_PREVIOUS_BUILD=1
BUILD_SWAPPED=1
mv -- "$STAGED_BUILD_PATH" "$APP_DIR/.next"

# Tabs opened before the deploy still request the previous build's hashed
# chunks/CSS. Those hashes are content-addressed and unique, so carrying them
# into the new static dir (never overwriting) keeps old sessions alive instead
# of crashing with ChunkLoadError / "Something went wrong" until reload.
if [[ -d "$PREVIOUS_BUILD_PATH/static" ]]; then
  log "--- Carrying previous build's hashed static assets forward for open tabs"
  cp -an -- "$PREVIOUS_BUILD_PATH/static/." "$APP_DIR/.next/static/" || true
fi

log "--- Reloading PM2"
pm2 startOrReload ecosystem.config.js --update-env
pm2 save

# Cluster reloads can leave an old next-server attached to the PM2 god
# process. That orphan keeps serving HTML that references deleted chunk
# hashes → blank white page after login for ~half of requests. Kill any
# next-server whose PID is not in the current deed-erp process list.
log "--- Reaping orphaned next-server workers"
alive_pids="$(pm2 jlist | node -e '
  let raw = "";
  process.stdin.on("data", c => { raw += c; });
  process.stdin.on("end", () => {
    const apps = JSON.parse(raw || "[]");
    const pids = apps
      .filter(app => app.name === "deed-erp" && app.pid)
      .map(app => String(app.pid));
    process.stdout.write(pids.join(" "));
  });
')"
for pid in $(pgrep -f 'next-server \(v' || true); do
  if [[ " ${alive_pids} " == *" ${pid} "* ]]; then
    continue
  fi
  log "Killing orphaned next-server pid=${pid}"
  kill -9 -- "$pid" || true
done

log "--- Health checking $HEALTH_URL"
code=none
for ((attempt=1; attempt<=HEALTH_ATTEMPTS; attempt++)); do
  code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time "$HEALTH_INTERVAL" "$HEALTH_URL" || true)"
  if [[ "$code" == 200 ]]; then
    printf '%s\n' "$(git rev-parse HEAD)" >"$ROLLBACK_STATE_DIR/deployed-commit"
    printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$ROLLBACK_STATE_DIR/deploy-completed-utc"
    rm -f -- "$BACKUP_RESULT_FILE"
    BACKUP_RESULT_FILE=
    trap - ERR
    log "Healthy after attempt $attempt (HTTP $code)"
    log "=== Deploy OK $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    exit 0
  fi
  sleep "$HEALTH_INTERVAL"
done

log "Health check failed after $HEALTH_ATTEMPTS attempts (last HTTP code: $code)"
false
