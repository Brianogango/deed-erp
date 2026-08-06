#!/usr/bin/env bash
# P0-SRV-001 — SSH hardening checklist (run as root with Contabo console open)
set -euo pipefail
echo "1) Create sudo user deedops (if missing)"
id deedops >/dev/null 2>&1 || adduser --disabled-password --gecos '' deedops
usermod -aG sudo deedops
mkdir -p /home/deedops/.ssh
chmod 700 /home/deedops/.ssh
# Append your public key to /home/deedops/.ssh/authorized_keys then:
#   chown -R deedops:deedops /home/deedops/.ssh && chmod 600 /home/deedops/.ssh/authorized_keys
echo "2) Test a SECOND session: ssh deedops@HOST before continuing"
echo "3) Write /etc/ssh/sshd_config.d/99-hardening.conf"
cat >/etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sshd -t
systemctl reload ssh
echo "4) Verify: sshd -T | grep -Ei 'permitrootlogin|passwordauthentication'"
echo "5) Install fail2ban"
apt-get update -y && apt-get install -y fail2ban
cat >/etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
bantime = 1h
findtime = 10m
maxretry = 5
EOF
systemctl enable --now fail2ban
fail2ban-client status sshd || true
echo "6) Remove stale ufw 3001 (SRV-004)"
ufw delete allow 3001/tcp || true
ufw status verbose
echo "DONE — keep Contabo console available until fresh key login confirmed twice."
