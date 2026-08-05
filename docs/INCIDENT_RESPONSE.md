# Incident response runbook

Operational playbook for Deed ERP production incidents.  
**Do not put passwords, API keys, tokens, or private host details in tickets or chat.** Use your organisation’s secure channel (encrypted email / approved ops chat) for secrets and access.

Related: role guides in this folder · [role access design](../role_access_design.md) · [finance seals](./FINANCE_SALES_SEALS.md) · root [README](../README.md) deployment notes.

---

## 1. Severity classification

| Severity | Examples | Response target | Bridge |
|----------|----------|-----------------|--------|
| **SEV-1** | Full outage; data loss; confirmed credential leak; ransomware | Immediate — all hands | Director + on-call ops + Finance if money paths affected |
| **SEV-2** | Partial outage (one module); failed deploy with rollback; payment posting broken | &lt; 1 hour | Ops + module owner |
| **SEV-3** | Degraded performance; non-critical bug; single-user access issue | Same business day | Module owner |
| **SEV-4** | Docs / cosmetic; backlog items | Planned | Product / backlog |

When unsure, start at **SEV-2** and downgrade only after impact is clear.

---

## 2. Escalation paths

1. **Detect** — monitoring, staff report, customer portal complaint, deploy health check failure.
2. **Declare** — post in the secure ops channel: severity, symptom, start time, customer impact (Y/N), money-path impact (Y/N).
3. **Own** — one Incident Commander (IC). Others execute; avoid parallel conflicting fixes.
4. **Escalate up** — SEV-1 always notifies Director. Money-path incidents notify Finance Officer. Suspected breach notifies Director immediately (legal/comms as per company policy).
5. **Communicate out** — customer-facing updates only via approved spokespeople; no speculative root cause in public channels.
6. **Close** — restore service → verify → write short timeline → schedule post-incident review within 5 business days for SEV-1/2.

Secure channels only for: database URLs, SSH access, `.env` contents, backup locations, session secrets, Partner API keys.

---

## 3. Scenario A — Data loss or corruption

### Symptoms
Missing invoices/repairs, empty modules after a reset, failed restore, accidental admin wipe, disk failure.

### Immediate actions
1. **Stop writes** that could overwrite good data (pause non-essential staff use; avoid another admin reset).
2. **Do not** run undocumented SQL against production while diagnosing.
3. Identify last **verified** backup (manifest with `verified: true`).

### Backup & verify (production host, as ops)

Installed names (from repo scripts):

- `/usr/local/bin/deed-erp-backup.sh` ← `scripts/backup-db.sh`
- `/usr/local/bin/deed-erp-verify-backup.sh` ← `scripts/verify-backup.sh`

Create a fresh verified backup **before** any restore experiment (if the live DB is still partially good):

```bash
# On the production application host (ops access required)
sudo /usr/local/bin/deed-erp-backup.sh
```

A successful run writes PostgreSQL custom dump + blob/upload archives under the configured backup directory (default `/var/backups/deed-erp`), a SHA-256 manifest, and runs verification (isolated temp DB restore).

Verify an existing manifest:

```bash
sudo /usr/local/bin/deed-erp-verify-backup.sh /var/backups/deed-erp/<manifest>.json
# Optional artifact-only check (does NOT mark verified):
sudo /usr/local/bin/deed-erp-verify-backup.sh --skip-restore /var/backups/deed-erp/<manifest>.json
```

### Restore decision
- Prefer restore from the newest **verified** manifest.
- Restore procedures are environment-specific; perform under IC supervision with a second person checking the manifest checksums.
- After restore: smoke-check login, Finance invoice list, Repairs list, and one POS/stock read if those modules are in use.
- Document what was lost between backup time and incident time for Finance/compliance.

### Prevention
- Keep scheduled verified backups; never rely on `--skip-restore` for pre-deploy backups.
- Treat admin data-reset tools as SEV-1 capable — Director approval only.

---

## 4. Scenario B — Security breach or credential leak

### Symptoms
Unexpected admin users, mass data export, session anomalies, leaked `.env` / API key in chat or git, ransomware note, unexplained Partner API traffic.

### Immediate actions
1. **Declare SEV-1.** Restrict discussion to the secure channel.
2. **Contain**
   - Rotate `NEXTAUTH_SECRET` / session secrets and force re-login (Director + ops).
   - Deactivate compromised user accounts in **Settings → User Access** (Director).
   - Rotate database password, SMTP credentials, Partner API keys, and any cloud tokens that may have been exposed.
   - Revoke sessions for affected users (deactivate / role change invalidates sessions; use admin session invalidation if available).
3. **Preserve evidence** — copy relevant app logs and deploy logs to a secure store before rotating hosts; do not wipe disks until counsel/ops agree.
4. **Assess blast radius** — finance exports, customer PII, repair portal data, Partner API.
5. **Notify** — Director; follow company legal/customer notification policy. Do not notify customers with unconfirmed speculation.

### Hardening checklist after containment
- Confirm production deploy keys and GitHub/ co-deploy secrets were not the leak vector.
- Review recent user creates and role changes.
- Ensure file uploads still enforce type checks; disable unused Partner keys.
- Schedule password resets for staff if a shared secret was exposed.

---

## 5. Scenario C — Service outage

### Symptoms
Login page down, HTTP 5xx, blank app, PM2 process stopped, database connection errors, nginx upstream failures.

### Immediate actions
1. Confirm blast radius: internal only vs customer portal/track too.
2. On the production host (ops):

```bash
pm2 status
pm2 logs deed-erp --lines 200 --nostream
tail -n 200 /var/log/deed-erp-deploy.log
```

3. Check process health: `deed-erp` should be **online** (cluster mode). If stopped:

```bash
cd /var/www/deed-erp   # default APP_DIR
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
```

4. Confirm local health URL responds (default login page on localhost as used by the deploy script).
5. If the database is unreachable, treat as SEV-1 with hosting/DB provider — application restarts will not help until Postgres is back.
6. After recovery: IC posts “restored” time and residual risk.

### Communication
- Internal: symptom + ETA only until confirmed.
- External: only if customer-facing portal/payments are impacted and Director approves the message.

---

## 6. Scenario D — Failed deployment

### Symptoms
Deploy script exits non-zero; health check never returns HTTP 200; build failure; users see old or broken UI after a release.

### How production deploy behaves
`/usr/local/bin/deed-erp-deploy.sh` (from `scripts/deploy/deed-erp-deploy.sh`):

1. Requires a clean git worktree and an existing `.next` build.
2. Runs a **verified backup** first.
3. Fetches/checks out `DEPLOY_BRANCH` (usually `master`), installs, builds to `.next-staging`, swaps to `.next`, keeps `.next-previous`.
4. Reloads PM2 and health-checks the login URL.
5. **On failure after source sync:** hard-resets the app tree to the previous commit, restores `.next-previous`, reloads PM2. **Database is not migrated backward automatically.**

### Immediate actions
1. Read `/var/log/deed-erp-deploy.log` (credentials are redacted in the log stream).
2. Confirm whether automatic rollback already restored the previous commit/build (`pm2 status`, login health).
3. If the app is unhealthy and rollback did not complete, manually restore `.next` from `.next-previous` and reload PM2 (ops), then re-check login.
4. **Do not** force-push or re-run deploy in a loop without reading the build error.
5. Fix forward on a branch; re-deploy only after a clean build in CI/local.

### Database / migration caution
- Safe SQL migrations are additive (`IF NOT EXISTS`). If a release applied a migration then rolled back **code** only, the DB may be ahead of the code — coordinate with whoever owns schema changes before another deploy.
- Never restore a DB backup solely to “undo” a failed app deploy unless data corruption is confirmed (see Scenario A).

---

## 7. Post-incident review (SEV-1 / SEV-2)

Capture within 5 business days:

1. Timeline (detect → declare → contain → recover).
2. Customer / financial impact.
3. Root cause (primary + contributing).
4. What worked / what slowed response.
5. Action items with owners (backups, alerts, runbook gaps, code fixes).
6. Update this runbook if a step was wrong or missing.

Store the write-up in your secure ops documentation — not in public chat.

---

## 8. Quick reference — commands (no secrets)

| Purpose | Command / path |
|---------|----------------|
| Verified backup | `sudo /usr/local/bin/deed-erp-backup.sh` |
| Verify manifest | `sudo /usr/local/bin/deed-erp-verify-backup.sh <manifest.json>` |
| Deploy | `sudo DEPLOY_BRANCH=master /usr/local/bin/deed-erp-deploy.sh` |
| Process status | `pm2 status` |
| App logs | `pm2 logs deed-erp --lines 200 --nostream` |
| Deploy log | `tail -n 200 /var/log/deed-erp-deploy.log` |
| App directory (default) | `/var/www/deed-erp` |
| Backup directory (default) | `/var/backups/deed-erp` |

Replace defaults only via documented environment variables on the host — never commit production `.env` values into git or this runbook.
