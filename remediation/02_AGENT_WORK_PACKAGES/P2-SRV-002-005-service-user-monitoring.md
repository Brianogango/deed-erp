# P2-SRV-002-005 — Dedicated service user; restart-cause investigation; monitoring

## 1. Task identity
- **Task ID:** P2-SRV-002-005 · **Priority:** P2 · **Severity:** Medium
- **Assigned agent type:** DevOps Agent
- **Related findings:** SRV-002 (app/PM2 run as root), SRV-005 (restart churn, no monitoring) — bundled as both are infra-reliability work sequenced after SRV-001
- **Business owner:** confirms alert recipients · **Technical reviewer:** DevOps

## 2. Plain-language objective
If the website is ever compromised through a software bug, the damage is contained to the app itself, not the whole server. And if the app starts misbehaving (crashing, running out of memory, disk filling up), someone finds out automatically instead of a customer reporting it first.

## 3. Confirmed problem
- **Evidence (Addendum, 5 Aug 2026):** `pm2 list` showed `user root` on both `deed-erp` cluster instances; `systemd` unit is `pm2-root.service`; `/var/www` is owned by `david.karanja` while the runtime is root (mixed ownership). Separately, PM2 showed 123–124 restarts with only 9 minutes of uptime at inspection time, with Postgres `FATAL: terminating connection due to administrator command` in the app error log, and load average 4.09 on 4 vCPU.
- **Reproduction:** `pm2 list` on the Contabo host; `pm2 logs deed-erp --err`.
- **Expected:** app runs under a dedicated, unprivileged service account; restart cause is understood (deploy-triggered reloads are expected and benign; crash-loops are not); basic monitoring alerts on abnormal restarts, memory, CPU, disk, and DB connection errors.
- **Root cause:** provisioning convenience (root); no monitoring stack was ever installed.
- **Confidence:** High.

## 4. Scope
- Create a dedicated `deed-erp` (or similarly named) service user; migrate the PM2 process to run under that user via a user-level systemd unit; correct file ownership under `/var/www/deed-erp`.
- Classify the restart count: correlate PM2 restart timestamps against the deploy log (`/var/log/deed-erp-deploy.log`, referenced in prior deploy work) to confirm what fraction of restarts are deploy-triggered reloads (expected/benign) vs. unexpected crashes.
- Install a lightweight monitoring/alerting setup (e.g., `node-exporter` + an existing or new Prometheus/Grafana instance, or a simpler uptime + resource-check cron with alerting via the same channel used for backup alerts in P0-SRV-003) covering: process uptime, unexpected restarts, memory, CPU, disk, and application error-log patterns (e.g., repeated Postgres connection-termination messages).

## 5. Out of scope
- Application code changes (unless a specific crash cause is found to be a code bug, in which case that specific fix is scoped as a follow-up, not bundled here).
- SSH hardening (P0-SRV-001, must land first — do this package's user creation using the already-hardened SSH access pattern).
- Full observability platform buildout (APM, distributed tracing) — this package is basic health/resource monitoring only.

## 6. Likely affected components
- systemd PM2 service definition (`pm2-root.service` → new user-scoped unit)
- File ownership under `/var/www/deed-erp`
- `ecosystem.config.js` (PM2 config — confirm no root-specific assumptions)
- Deploy script `/usr/local/bin/deed-erp-deploy.sh` (must continue to work under the new user, or via `sudo` from the hardened admin account established in SRV-001)
- New: monitoring/alerting configuration (exact tool TBD by DevOps agent's assessment of the simplest reliable option for this host)

## 7. Implementation instructions
1. **After SRV-001 is complete** (do not run this package's SSH-dependent steps before the hardened access pattern exists): create the `deed-erp` service user, add it to any groups required for the app to bind its port (or continue using a reverse proxy on privileged ports, unaffected by this change since nginx already fronts the app).
2. `chown -R deed-erp:deed-erp /var/www/deed-erp` (verify no build artifacts or node_modules break from the ownership change — test a full deploy cycle immediately after).
3. Create a new PM2 systemd service scoped to the `deed-erp` user (`pm2 startup systemd -u deed-erp --hp /home/deed-erp`), migrate the running process, and decommission `pm2-root.service` only after confirming the new unit starts cleanly and survives a reboot test.
4. Update `deed-erp-deploy.sh` if it assumes root — it may need to run via `sudo -u deed-erp` for PM2 commands while retaining root/sudo only for file permission or nginx-reload steps that genuinely require it.
5. Pull PM2 restart timestamps (`pm2 describe deed-erp` / `~/.pm2/pm2.log`) and cross-reference against deploy history; produce a short report distinguishing deploy-triggered reloads from unexplained crashes.
6. Install the chosen monitoring solution; configure alerts for: process down/restarting unexpectedly, memory above a threshold, disk above a threshold, and repeated `FATAL: terminating connection` patterns in the app log within a short window (indicative of DB pool issues distinct from normal deploy reloads).
7. Test each alert by inducing the condition in a controlled way (e.g., temporarily fill disk in a scratch directory, or force a PM2 restart) and confirming the alert fires and is received.

## 8. Acceptance criteria
- `pm2 list` shows the app running under a non-root user.
- A full deploy cycle succeeds under the new user/ownership without permission errors.
- The restart-cause report clearly attributes each restart category (deploy vs. crash) for the inspection period and going forward.
- Alerts fire and are received for each induced test condition (process down, high memory, high disk, DB connection-termination pattern).

## 9. Test plan
- Manual: full deploy cycle post-migration; reboot test of the new systemd unit.
- Manual: each alert-condition simulation with confirmed delivery.
- No automated test suite applies (infrastructure).

## 10. Evidence required from the implementing agent
`pm2 list` output before/after; ownership listing before/after; deploy-cycle log showing success under the new user; restart-cause report; alert-firing screenshots/logs for each condition; rollback plan (keep `pm2-root.service` disabled but not deleted until the new unit has run stably for an agreed period).

## 11. Deployment plan
- No app branch — infrastructure change on the Contabo VPS, sequenced strictly after P0-SRV-001.
- **Human gate:** business owner confirms alert-recipient contact(s).
- **Smoke test:** deploy a trivial, already-tested change through the normal pipeline post-migration to confirm the full path (build → PM2 reload → health check) still works end-to-end under the new user.
- **Rollback trigger:** deploy failures under the new user/ownership that cannot be quickly resolved → revert to `pm2-root.service` and restore prior ownership while investigating.
