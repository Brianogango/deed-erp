/**
 * Ops scripts for Contabo hardening (P0-SRV-001 / P0-SRV-003).
 * These are NOT run automatically — execute on the VPS with a Contabo
 * web console open for the SSH final switch.
 *
 * Do not commit secrets. Fill placeholders on the server only.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const root = join(process.cwd(), 'scripts', 'ops')
mkdirSync(root, { recursive: true })

writeFileSync(join(root, 'srv-001-ssh-hardening.sh'), `#!/usr/bin/env bash
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
`)

writeFileSync(join(root, 'srv-003-backup-offsite.sh.example'), `#!/usr/bin/env bash
# P0-SRV-003 — additive offsite step for deed_erp_backup.sh
# Source /etc/deed-erp/backup.env (mode 600) for DB creds — never embed passwords.
# Requires: age or gpg, rclone configured for Decision-7 destination, optional HC_PING_URL.
set -euo pipefail
: "\${BACKUP_ROOT:=/var/backups/deed-erp}"
LATEST=$(ls -1dt "\$BACKUP_ROOT"/*/ 2>/dev/null | head -1 || true)
if [[ -z "\${LATEST}" ]]; then echo "No local backup to ship"; exit 0; fi
# Exclude plaintext .env from the offsite tarball
ARCHIVE="/tmp/deed-erp-offsite-\$(date +%Y%m%d%H%M%S).tar.gz"
tar -C "\$LATEST" --exclude='.env' --exclude='*.env' -czf "\$ARCHIVE" .
if command -v age >/dev/null && [[ -n "\${AGE_RECIPIENT:-}" ]]; then
  age -r "\$AGE_RECIPIENT" -o "\${ARCHIVE}.age" "\$ARCHIVE"
  UPLOAD="\${ARCHIVE}.age"
else
  UPLOAD="\$ARCHIVE"
fi
if command -v rclone >/dev/null && [[ -n "\${RCLONE_REMOTE:-}" ]]; then
  rclone copy "\$UPLOAD" "\$RCLONE_REMOTE" --checksum
fi
if [[ -n "\${HC_PING_URL:-}" ]]; then
  curl -fsS --retry 3 "\$HC_PING_URL" >/dev/null || curl -fsS --retry 3 "\${HC_PING_URL}/fail" >/dev/null || true
fi
rm -f "\$ARCHIVE" "\${ARCHIVE}.age" 2>/dev/null || true
`)

writeFileSync(join(root, 'README.md'), `# Contabo ops packages (P0-SRV-001 / P0-SRV-003)

- \`srv-001-ssh-hardening.sh\` — run on the VPS with Contabo console open. Final password-auth disable requires human confirmation.
- \`srv-003-backup-offsite.sh.example\` — template for encrypt+rclone after local backup. Needs Decision 7 destination credentials on the server (\`/etc/deed-erp/backup.env\`, mode 600).

Never store DB passwords or \`.env\` copies in git or in plaintext backup artifacts.
`)

console.log('Wrote scripts/ops/*')
