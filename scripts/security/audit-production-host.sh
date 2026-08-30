#!/usr/bin/env bash
set -u

APP_DIR="${APP_DIR:-/var/www/deed-erp}"
REPORT_ONLY=1

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
command -v apt-get >/dev/null && run apt-get -s upgrade
command -v unattended-upgrade >/dev/null && run systemctl is-enabled unattended-upgrades

section "Listening services"
run ss -lntup

section "Firewall"
command -v ufw >/dev/null && run ufw status verbose
command -v nft >/dev/null && run nft list ruleset

section "SSH effective policy"
if command -v sshd >/dev/null; then
  run sshd -T
else
  echo "sshd not found"
fi

section "Fail2ban"
command -v fail2ban-client >/dev/null && run fail2ban-client status

section "Nginx TLS / proxy posture"
if command -v nginx >/dev/null; then
  run nginx -t
  nginx -T 2>&1 | grep -Ei 'listen .*443|ssl_protocols|ssl_ciphers|server_tokens|strict-transport-security|content-security-policy|proxy_pass|client_max_body_size' || true
fi

section "PostgreSQL exposure"
if command -v psql >/dev/null; then
  run psql -Atqc "SHOW listen_addresses; SHOW port; SHOW ssl;" postgres
fi
[ -r /etc/postgresql/*/main/pg_hba.conf ] && grep -Ev '^\s*(#|$)' /etc/postgresql/*/main/pg_hba.conf || true

section "Application ownership and secret permissions"
if [ -d "$APP_DIR" ]; then
  run stat -c '%U:%G %a %n' "$APP_DIR"
  [ -e "$APP_DIR/.env" ] && run stat -c '%U:%G %a %n' "$APP_DIR/.env"
  [ -d "$APP_DIR/.uploads" ] && run stat -c '%U:%G %a %n' "$APP_DIR/.uploads"
  [ -d "$APP_DIR/backups" ] && run stat -c '%U:%G %a %n' "$APP_DIR/backups"
  run git -C "$APP_DIR" status --short
  run git -C "$APP_DIR" rev-parse HEAD
else
  echo "Application directory not found: $APP_DIR"
fi

section "PM2 / process privilege"
command -v pm2 >/dev/null && run pm2 jlist
run ps -eo user,pid,ppid,cmd --sort=user

section "Privileged users and sudo"
run getent passwd
[ -r /etc/sudoers ] && grep -Ev '^\s*(#|$)' /etc/sudoers || true
[ -d /etc/sudoers.d ] && grep -R -Ev '^\s*(#|$)' /etc/sudoers.d 2>/dev/null || true

section "Scheduled persistence"
run systemctl list-timers --all
run find /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /var/spool/cron -maxdepth 2 -type f -ls

section "Recent auth failures"
if command -v journalctl >/dev/null; then
  journalctl -u ssh --since '7 days ago' 2>/dev/null | tail -n 300 || true
  journalctl -u sshd --since '7 days ago' 2>/dev/null | tail -n 300 || true
fi

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
echo "This script is read-only. Review the output before applying host changes."
