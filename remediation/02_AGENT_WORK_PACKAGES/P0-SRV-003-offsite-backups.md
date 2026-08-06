# P0-SRV-003 — Off-site encrypted backups; remove secrets from backup artifacts

## 1. Task identity
- **Task ID:** P0-SRV-003 · **Priority:** P0 · **Severity:** High
- **Assigned agent type:** DevOps Agent
- **Related findings:** SRV-003; closes the residual of DEVOPS-001 (backups verified locally but not off-host)
- **Business owner:** Director (owns the off-site storage account/billing) · **Technical reviewer:** DevOps/Security

## 2. Plain-language objective
A copy of every backup leaves the server automatically and is stored somewhere else, encrypted, so that losing the Contabo VPS does not mean losing the business's financial and customer data. The backup files themselves no longer contain the system's master password file.

## 3. Confirmed problem
- **Evidence (Addendum, 5 Aug 2026):**
  - `/usr/local/bin/deed_erp_backup.sh`: `BACKUP_ROOT=/var/backups/deed-erp`, `DB_PASS` hardcoded in the script, `.env` copied into every backup directory.
  - No `rsync`/`rclone`/S3/offsite step found in cron or scripts.
  - Two schedules exist: root crontab every 4h, and `/etc/cron.d/deed-erp-backup` daily at 02:00 — both write only to local disk (`/var/backups/deed-erp`, `/root/backups`).
  - A real restore was performed 2026-06-28, proving the backup content itself is valid — the gap is exclusively "off-host copy" and "secrets in artifact."
- **Reproduction:** inspect `/usr/local/bin/deed_erp_backup.sh` and the two cron jobs; no network egress to any storage endpoint present.
- **Expected:** every backup run produces an encrypted copy on a separate host/cloud storage account; no plaintext `.env` or DB password in any artifact.
- **Root cause:** backup automation was built for local convenience and never extended.
- **Confidence:** High.

## 4. Scope
- Add a post-backup step that encrypts (age or GPG) and uploads the archive to an off-site destination (object storage bucket or a second host via `rclone`/`rsync` over SSH key auth).
- Remove the hardcoded DB password from the script; move it to a root-only-readable `.pgpass` or a script-local env file with `chmod 600`.
- Exclude `.env` from the backup artifact, or encrypt it separately with a key not stored alongside the backup.
- Add success/failure alerting (a `curl` ping to a dead-man's-switch service such as healthchecks.io, or a mail-on-failure hook) for both cron schedules.
- Perform one documented restore drill from the off-site copy into `deed_erp_staging`.

## 5. Out of scope
- Changing the backup schedule/frequency itself.
- Application code changes.
- SSH hardening (SRV-001, separate package, but the off-site host/bucket credentials should use key auth consistent with that work).
- Migrating the app to run as a non-root user (SRV-002).

## 6. Likely affected components
- `/usr/local/bin/deed_erp_backup.sh`
- root crontab entry (every 4h)
- `/etc/cron.d/deed-erp-backup` (daily 02:00)
- New: off-site destination configuration (bucket/host credentials, stored outside the repo and outside backup artifacts)
- New: alerting hook script

## 7. Implementation instructions
1. Read the current `deed_erp_backup.sh` in full before changing anything; preserve its existing dump format (custom + gzipped SQL) and 30-run retention exactly as-is for the local copy — this task is additive.
2. Move `DB_PASS` out of the script body: create `/root/.pgpass` (format `hostname:port:database:username:password`, mode 600) or a separate `/etc/deed-erp/backup.env` (mode 600, root-only) sourced by the script; update the script to stop embedding the password inline.
3. Stop copying `.env` verbatim into the backup directory. Either (a) omit it entirely from the artifact (acceptable — it can be restored from the deploy config / secret store), or (b) if it must travel with the backup for disaster recovery, encrypt it separately with `age -r <public-key>` before inclusion, never in plaintext.
4. Add an off-site step at the end of the script: encrypt the completed local archive (`age` or `gpg --symmetric`/`--recipient`) and push it with `rclone copy` (configured for the chosen provider) or `rsync -e ssh` to a second host. Use a dedicated, least-privilege credential for the off-site destination (not the server's own SSH key).
5. Add a success ping (`curl -fsS --retry 3 https://hc-ping.com/<uuid>`) after a successful off-site upload, and a failure ping (`.../fail`) in the script's error trap, for both the 4-hourly and daily jobs. Confirm the owner has a monitoring account (healthchecks.io free tier or equivalent) — request one if not.
6. Run the script manually once, end-to-end, and verify: (a) local backup unchanged in format, (b) off-site copy exists and decrypts correctly to the same content, (c) no `.env` plaintext or DB password appears in any backup artifact (`grep -R` a known password substring — do not print the actual value in logs/reports).
7. Perform the restore drill: pull the off-site copy down to a scratch location, decrypt, restore into `deed_erp_staging` (never production), and confirm row counts/spot-check against the live source.
8. Document the whole procedure (destination, encryption key custody, restore steps) in `docs/` as an addition to existing backup documentation — do not put credentials in the docs.

## 8. Acceptance criteria
- Every scheduled backup run (both the 4-hourly and daily jobs) produces a verified, checksummed, encrypted off-site copy.
- No backup artifact anywhere (local or off-site) contains a plaintext `.env` file or a plaintext database password.
- A simulated backup failure triggers a failure alert within one run cycle.
- A restore from the off-site copy into `deed_erp_staging` succeeds and is documented with before/after row counts.

## 9. Test plan
- Manual: full run of the modified script; artifact inspection for secrets (grep-based, no secret values echoed in the report).
- Manual: kill the off-site upload step deliberately once to confirm the failure alert fires.
- Manual: restore drill into staging with reconciliation counts.
- No automated test suite applies (shell/infra script).

## 10. Evidence required from the implementing agent
- Diff of `deed_erp_backup.sh` (secrets redacted).
- Confirmation output that no `.env`/password string appears in a sample artifact (command shown, output shown, no secret values printed).
- Restore-drill log with row-count reconciliation against production at the time of the backup.
- Alert-firing screenshot/log from the monitoring service.
- Rollback: original script preserved as `deed_erp_backup.sh.bak-<date>`.

## 11. Deployment plan
- No branch/app deploy — infrastructure script change on the Contabo VPS.
- **Human gate:** business owner provides or approves the off-site storage account (Decision 7) before credentials are configured.
- **Migration order:** n/a.
- **Smoke test:** one full manual run before relying on cron.
- **Rollback trigger:** if the off-site step ever blocks or slows the local backup (it must be strictly additive/non-blocking — run local backup first, then off-site as a best-effort follow-on step with its own error handling that never fails the local backup).
