#!/usr/bin/env bash
#
# Atomic deploy for the Deed ERP.
#
# The problem this solves: `next build` rewrites .next in place, and the live
# server is serving out of that exact directory. So the moment a build starts,
# the running app loses its own files and crashes — PM2 restarts it, it crashes
# again because the build is still running, and it loops until the build
# finishes. A deploy on 2026-09-27 showed 42 restarts and several minutes of
# 502s. Worse, a build that failed halfway left the site down with no previous
# version to fall back to.
#
# Here the build goes into .next-build while .next keeps serving. Only once it
# succeeds are the two swapped, which is a rename and therefore instant. A
# failed build never reaches the swap and the running site is untouched.
#
# Usage:  sudo bash scripts/deploy.sh
#         sudo bash scripts/deploy.sh --rollback     (restore the previous build)
#
# Migrations are deliberately NOT run here. Schema changes are applied by hand,
# in the order the change requires, by someone who has read them.

set -euo pipefail

APP_DIR="/var/www/deed-erp"
APP_USER="deedapp"
PM2_APP="deed-erp"
PORT="${PORT:-3000}"
HEALTH_PATH="/api/version"
HEALTH_TIMEOUT=90

cd "$APP_DIR"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m!!  %s\033[0m\n\n' "$*" >&2; exit 1; }

reload_app() {
  sudo -u "$APP_USER" pm2 reload "$PM2_APP"
}

# Poll until the app answers, so "deployed" means "serving", not "pm2 said ok".
wait_for_health() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}${HEALTH_PATH}" || true)
    if [[ "$code" == "200" || "$code" == "401" || "$code" == "403" ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# ── Rollback ────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--rollback" ]]; then
  [[ -d .next-prev ]] || die "No .next-prev to roll back to."
  say "Rolling back to the previous build"
  rm -rf .next-failed
  mv .next .next-failed
  mv .next-prev .next
  reload_app
  if wait_for_health; then
    say "Rolled back. The bad build is in .next-failed if you want to look at it."
  else
    die "Rolled back but the app is still not answering. Check: sudo -u $APP_USER pm2 logs $PM2_APP"
  fi
  exit 0
fi

# ── Deploy ──────────────────────────────────────────────────────────────────
say "Fetching"
LOCK_BEFORE=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || echo none)
git pull --ff-only
LOCK_AFTER=$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || echo none)

# Installing dependencies mid-deploy can leave node_modules broken with no way
# back, so this stops and hands the decision over rather than doing it.
if [[ "$LOCK_BEFORE" != "$LOCK_AFTER" ]]; then
  die "package-lock.json changed. Run 'npm ci' yourself, then re-run this script."
fi

say "Building into .next-build — the live site keeps serving from .next"
rm -rf .next-build
if ! NEXT_DIST_DIR=.next-build NODE_OPTIONS=--max-old-space-size=4096 npm run build; then
  rm -rf .next-build
  die "Build failed. Nothing was swapped — the site is still running the previous build."
fi

[[ -f .next-build/BUILD_ID ]] || die "Build produced no BUILD_ID. Refusing to swap."

say "Swapping the new build into place"
rm -rf .next-prev
mv .next .next-prev
mv .next-build .next

say "Reloading $PM2_APP"
reload_app

if wait_for_health; then
  say "Deployed. Previous build kept in .next-prev — 'bash scripts/deploy.sh --rollback' restores it."
else
  warn "The app is not answering after $HEALTH_TIMEOUT seconds. Rolling back."
  rm -rf .next-failed
  mv .next .next-failed
  mv .next-prev .next
  reload_app
  if wait_for_health; then
    die "Rolled back to the previous build, which is serving. The bad build is in .next-failed."
  fi
  die "Rollback did not recover either. Check: sudo -u $APP_USER pm2 logs $PM2_APP"
fi
