#!/usr/bin/env bash
set -u

APP_DIR="${APP_DIR:-/var/www/deed-erp}"
EXPECTED_COMMIT_SHA="${EXPECTED_COMMIT_SHA:-}"

section() { printf '\n==== %s ====\n' "$1"; }
run() {
  printf '$ %s\n' "$*"
  "$@" 2>&1 || true
}

section "Identity and OS"
run id
run uname -a
[ -r /etc/os-release ] && cat /etc/os-release
run uptime

section "Security updates"
if command -v apt-get >/dev/null; then
  apt-get -s upgrade 2>/dev/null | grep -E '^[0-9]+ upgraded|^Inst ' | head -n 80 || true
fi
if command -v systemctl >/dev/null; then
  run systemctl is-enabled unattended-upgrades
  run systemctl is-active unattended-upgrades
fi

section "Listening services"
run ss -lntup

section "Firewall"
command -v ufw >/dev/null && run ufw status verbose
command -v nft >/dev/null && run nft list ruleset

section "SSH effective policy"
if command -v sshd >/dev/null; then
  sshd -T 2>/dev/null | grep -Ei '^(permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|challengeresponseauthentication|maxauthtries|allowusers|allowgroups) ' || true
fi

section "Fail2ban"
command -v fail2ban-client >/dev/null && run fail2ban-client status

section "Nginx TLS and proxy posture"
if command -v nginx >/dev/null; then
  run nginx -t
  nginx -T 2>&1 | grep -Ei 'listen .*443|ssl_protocols|ssl_ciphers|server_tokens|strict-transport-security|content-security-policy|proxy_pass|client_max_body_size' || true
fi

section "PostgreSQL exposure"
if command -v psql >/dev/null; then
  psql -Atqc "SHOW listen_addresses; SHOW port; SHOW ssl;" postgres 2>/dev/null || true
fi
for f in /etc/postgresql/*/main/pg_hba.conf; do
  [ -r "$f" ] && { echo "-- $f"; grep -Ev '^\s*(#|$)' "$f" || true; }
done

section "Application provenance and permissions"
if [ -d "$APP_DIR" ]; then
  run stat -c '%U:%G %a %n' "$APP_DIR"
  [ -e "$APP_DIR/.env" ] && run stat -c '%U:%G %a %n' "$APP_DIR/.env"
  [ -d "$APP_DIR/uploads" ] && run stat -c '%U:%G %a %n' "$APP_DIR/uploads"
  [ -d "$APP_DIR/backups" ] && run stat -c '%U:%G %a %n' "$APP_DIR/backups"
  LIVE_SHA="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)"
  echo "live_commit_sha=$LIVE_SHA"
  if [ -n "$EXPECTED_COMMIT_SHA" ]; then
    echo "expected_commit_sha=$EXPECTED_COMMIT_SHA"
    if [ "$LIVE_SHA" != "$EXPECTED_COMMIT_SHA" ]; then
      echo "FAIL: production commit does not match expected commit" >&2
      exit 20
    fi
    echo "PASS: production commit matches expected commit"
  fi
  run git -C "$APP_DIR" status --short
else
  echo "FAIL: application directory not found: $APP_DIR" >&2
  exit 21
fi

section "PM2 and process privilege"
command -v pm2 >/dev/null && run pm2 ls
ps -eo user,pid,ppid,comm,args --sort=user | grep -E 'node|next|pm2|nginx|postgres' | grep -v grep || true

section "Scheduled jobs"
run systemctl list-timers --all
run find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /var/spool/cron -maxdepth 2 -type f -ls

section "Kernel hardening snapshot"
for k in \
  net.ipv4.conf.all.rp_filter \
  net.ipv4.conf.default.rp_filter \
  net.ipv4.tcp_syncookies \
  kernel.randomize_va_space \
  kernel.kptr_restrict \
  kernel.dmesg_restrict \
  fs.protected_hardlinks \
  fs.protected_symlinks; do
  sysctl "$k" 2>/dev/null || true
done

section "Audit complete"
echo "Read-only audit completed. No environment values or application secrets were printed."
