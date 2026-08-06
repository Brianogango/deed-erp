# Contabo ops packages (P0-SRV-001 / P0-SRV-003)

- `srv-001-ssh-hardening.sh` — run on the VPS with Contabo console open. Final password-auth disable requires human confirmation.
- `srv-003-backup-offsite.sh.example` — template for encrypt+rclone after local backup. Needs Decision 7 destination credentials on the server (`/etc/deed-erp/backup.env`, mode 600).

Never store DB passwords or `.env` copies in git or in plaintext backup artifacts.
