# P0-SRV-001 — SSH hardening and root credential rotation

## 1. Task identity
- **Task ID:** P0-SRV-001 · **Priority:** P0 · **Severity:** High
- **Assigned agent type:** DevOps Agent, **with a human operator holding the Contabo web console open** during the final switch
- **Related findings:** SRV-001; SRV-004 bundled (stale ufw rule, one-liner)
- **Business owner:** Director (custodian of new credentials) · **Technical reviewer:** Security

## 2. Plain-language objective
Only named people with cryptographic keys can reach the server. Password guessing becomes impossible. The password that was shared in plain text during the audit stops working. There is always a tested emergency way back in through Contabo's own console.

## 3. Confirmed problem
- **Evidence (Backend Validation Addendum, 5 Aug 2026 — infrastructure state, not expected to have changed):**
  - `/etc/ssh/sshd_config`: `PermitRootLogin yes`
  - `/etc/ssh/sshd_config.d/50-cloud-init.conf` and `60-cloudimg-settings.conf`: `PasswordAuthentication yes`
  - `fail2ban-client`: not installed
  - `ufw status`: `22/tcp ALLOW Anywhere` (v4+v6); `3001/tcp ALLOW` with no listener (SRV-004)
  - The root password was shared in plaintext during the audit engagement.
- **Reproduction:** `ssh root@<ip>` from any IP prompts for a password.
- **Expected:** root password login refused; only key-based login for a named sudo user; repeated failures rate-limited/blocked.
- **Root cause:** default cloud-init sshd configuration was never hardened after provisioning.
- **Confidence:** High.

## 4. Scope
- Rotate the root password.
- Create (or confirm) a non-root sudo user with SSH key authentication.
- Disable `PermitRootLogin` and `PasswordAuthentication` (including cloud-init drop-ins).
- Install and configure fail2ban for sshd.
- Remove the stale `3001/tcp` ufw rule.
- Document the Contabo console recovery path.

## 5. Out of scope
- Application code changes.
- Any change to nginx, PM2, or the deployed app.
- Migrating the app off root (that is SRV-002, a separate package, sequenced after this one).
- Changing firewall rules for any port other than the stale 3001 rule.

## 6. Likely affected components
- `/etc/ssh/sshd_config`
- `/etc/ssh/sshd_config.d/50-cloud-init.conf`, `60-cloudimg-settings.conf`
- `ufw` rule set
- New: `/etc/fail2ban/jail.local`
- New sudo user + `~/.ssh/authorized_keys`
- `/usr/local/bin/deed-erp-deploy.sh` and any script referencing `root@` (verify none hardcode root-only access in a way that breaks after this change)

## 7. Implementation instructions
1. **Before touching sshd:** create the new sudo user (`adduser deedops && usermod -aG sudo deedops`), generate or receive their public key, append to `/home/deedops/.ssh/authorized_keys` (mode 600, dir mode 700, correct ownership).
2. Open a **second** SSH session as `deedops` using the key and confirm `sudo -l` works, while the original root session stays open. Do not proceed if this fails.
3. Rotate the root password (`passwd root`) to a new, long, randomly generated value known only to the business owner via a secure channel (e.g., password manager) — do not store it in any repo, script, or chat log.
4. Edit `/etc/ssh/sshd_config`: `PermitRootLogin no`. Edit or override the two cloud-init drop-ins (create `/etc/ssh/sshd_config.d/99-hardening.conf` with `PasswordAuthentication no` — drop-ins are read in lexical order, so a `99-` file overrides `50-`/`60-` files; verify with `sshd -T | grep -i passwordauth`).
5. `systemctl reload sshd` (not restart, to avoid dropping the open sessions). Confirm via a **third**, fresh SSH connection attempt: root+password must be refused; `deedops`+key must succeed.
6. Only after step 5 is confirmed from a fresh connection, install fail2ban (`apt install fail2ban`), enable the sshd jail with a sane `bantime`/`findtime`/`maxretry` (e.g., 1h ban after 5 failures in 10 min), `systemctl enable --now fail2ban`.
7. Remove the stale rule: `ufw delete allow 3001/tcp` (and v6 equivalent if separate); `ufw status verbose` to confirm.
8. Write a one-page recovery note (in the DevOps runbook, not in this repo unless requested) describing: Contabo web console access, how to reach the VM if SSH is ever locked out, and where the new root password is stored.
9. Keep the original root SSH session open and unused as a fallback until step 5's fresh-connection test has passed twice (immediately, and again 10 minutes later).

## 8. Acceptance criteria
- `ssh root@<ip>` with any password is refused.
- `ssh deedops@<ip>` with the registered key succeeds and `sudo` works.
- `sshd -T` reports `permitrootlogin no` and `passwordauthentication no`.
- `fail2ban-client status sshd` shows the jail active; a simulated burst of failed logins from a throwaway source results in a ban.
- `ufw status` no longer lists `3001/tcp`.
- The Contabo console can still reach the VM (verified, not just assumed).

## 9. Test plan
- Manual: parallel-session verification exactly as in steps 2 and 5.
- Manual: fail2ban ban simulation (`sshpass` failed attempts from a disposable script, observe ban).
- Manual: Contabo console login test (confirms recovery path before old access is fully gone).
- No automated tests apply (infrastructure, not application code).

## 10. Evidence required from the implementing agent
- Timestamped transcript of each verification step (sessions opened/closed, fresh-connection tests).
- `sshd -T` output (secrets redacted — there are none in this command's output).
- `ufw status verbose` before/after.
- `fail2ban-client status sshd` output.
- Confirmation the new root password was delivered to the business owner via an out-of-band secure channel (do not paste it into any report, log, or chat).
- Rollback procedure actually tested via the Contabo console.

## 11. Deployment plan
- No branch/build — this is infrastructure-only, executed directly on the Contabo VPS by the DevOps agent under human supervision.
- **Human gate:** the business owner (or delegate) must be reachable/available during the entire window in case Contabo console access is needed.
- **Maintenance window:** none required for the app (SSH-only change); agree a window per Decision 6 as a safety margin.
- **Rollback trigger:** if the fresh-connection test in step 5 fails, immediately revert `PermitRootLogin`/`PasswordAuthentication` to `yes` using the still-open root session, `systemctl reload sshd`, and retry from scratch.
