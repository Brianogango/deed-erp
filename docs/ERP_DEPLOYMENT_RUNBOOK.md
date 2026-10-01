# Deed ERP — Deployment and Operations Runbook

| | |
|---|---|
| **Document** | ERP Deployment Runbook (supporting document to [`DEED_ERP_SYSTEM_DOCUMENTATION.md`](./DEED_ERP_SYSTEM_DOCUMENTATION.md)) |
| **Repository / branch / commit reviewed** | `brianogango/deed-erp` · `claude/focused-einstein-lqo6u8` · `1713b7bf39c24703b8f5ab986104868d9de89b87` |
| **Review date** | 2026-10-01 |
| **Basis** | `.github/workflows/*.yml`, `scripts/deploy/*.sh`, `scripts/*.sh`, `ecosystem.config.js`, `ops/nginx-deed-erp.conf.example`, `.env*.example`, `README.md`, `docs/PRISMA_STATE_CUTOVER.md`, `docs/INFRA_PLATFORM.md`, `docs/INCIDENT_RESPONSE.md` |

> **Safety rules for operators (from `AGENTS.md` and the scripts).** Treat `/var/www/deed-erp` and the production PostgreSQL database as read-only unless a deployment or server change was explicitly requested. Never point a development or cloud agent at the production database or copy production customer data into a development environment. Never write passwords, database URLs, secrets or session cookies into tracked files, terminal logs, screenshots, tickets or pull-request text. **This document lists variable *names* only.** Items that exist only on the server (the live `.env`, cron entries, Nginx site files, PM2 state, the backup schedule) are **not in the repository and could not be verified**; they are marked *(server-side — unverified)*.

## 1. Environments

| Environment | What it is | Source |
|---|---|---|
| **Production** | Contabo VPS: Nginx (TLS, Let's Encrypt) → PM2 `deed-erp` (cluster, 2 workers, port 3000) → Next.js; PostgreSQL bound to localhost; app in `/var/www/deed-erp`; blobs `/var/lib/deed-erp/blobs`; uploads `/var/www/deed-erp/.uploads`; backups `/var/backups/deed-erp`; rollback state `/var/lib/deed-erp/deploy-rollback` | `ecosystem.config.js`, `scripts/backup-db.sh`, `scripts/deploy/deed-erp-deploy.sh`, `AGENTS.md` |
| **CI** | GitHub Actions: `quality` (typecheck, unit tests, `pnpm audit`), `e2e` (Postgres 16 service, `prisma db push`, build, Playwright), `deploy` (master only) | `.github/workflows/deploy.yml` |
| **PR / preview** | Netlify deploy-preview runs `pnpm install --frozen-lockfile && validate:notifications && typecheck && test && build`; `notification-platform-ci.yml` runs on one named branch and PRs to master | `netlify.toml`, `.github/workflows/notification-platform-ci.yml` |
| **Local / cloud-agent** | `VISREG_BYPASS_AUTH=true npm run dev` (no database, standard visual-regression user, honoured only when `NODE_ENV !== 'production'`), or a disposable PostgreSQL with `npx prisma db push` and test-only credentials | `AGENTS.md`, `middleware.ts` |
| **Staging** | None found in the repository | — |

## 2. Server layout and ports

| Component | Detail | Evidence |
|---|---|---|
| Reverse proxy | Nginx: `443` TLS vhost for the production hostname → `proxy_pass http://127.0.0.1:3000` (WebSocket upgrade headers, `proxy_read_timeout 86400`, `client_max_body_size 50M`); static `/_next/static/` served from `/var/www/deed-erp/.next/static/` with 1-year immutable caching and fallback to the app; `80` vhost redirects the hostname to https but **also proxies requests addressed to the raw server IP over plain HTTP** | `ops/nginx-deed-erp.conf.example` |
| TLS | Let's Encrypt certificates under `/etc/letsencrypt/live/<hostname>/` (certbot options include) | same |
| Process manager | PM2 app `deed-erp`: `node_modules/next/dist/bin/next start`, `exec_mode: cluster`, `instances: 2`, `max_memory_restart: 1536M`, `--max-old-space-size=2048`, `kill_timeout 10 s`, `min_uptime 30 s`, `max_restarts 50`, env `NODE_ENV=production`, `PORT=3000` | `ecosystem.config.js` |
| Database | PostgreSQL on localhost; app role is non-superuser; DDL is applied by the `postgres` OS role because the table owner is `postgres` | `.env.production.example`, `scripts/apply-sql-as-postgres.sh` |
| Redis | Optional (`REDIS_URL` preferred, else Upstash REST); memory fallback otherwise | `lib/infra/redis.ts`, `lib/rate-limit.ts` |
| Object store | `OBJECT_STORE_DRIVER` = `fs` (default) or `s3` (`OBJECT_STORE_*`) | `lib/infra/object-store.ts` |
| Monitoring | In-process HTTP metrics (`lib/http-metrics.ts`, `POST /api/metrics/http` 404 beacon, `GET` for DIR/ADM); PM2 logs; `GET /api/version`; deploy health check on `/login`; `scripts/security/live-penetration-smoke.mjs` after deploy. **No external uptime/APM/alerting integration was found.** | |
| Domain | Configured outside the repo; `next.config.js` allow-lists the production/marketing hostnames for images; `NEXT_PUBLIC_APP_URL`/`NEXTAUTH_URL` carry the public URL | `next.config.js` |

## 3. Environment variable reference (names and purposes only)

`.env.example` and `.env.production.example` are the templates. Variables read by the code but **absent from the production template** are flagged — they default silently and must be set deliberately.

| Variable | In template | Purpose | First read in |
|---|---|---|---|
| `__PARITY_TSX__` | **no** | Internal marker used by `scripts/check-blob-parity.mjs` | `scripts/check-blob-parity.mjs` |
| `__TRANSFER_TSX__` | **no** | Internal marker used by `scripts/transfer-blobs-to-prisma.mjs` | `scripts/transfer-blobs-to-prisma.mjs` |
| `ACCOUNTING_POSTING_ENGINE` | yes | Feature flag for the central posting engine; must be `true` in production (`lib/accounting/posting-flag.ts`) | `lib/accounting/posting-flag.ts` |
| `ACCOUNTING_PRISMA_JOURNAL_WRITERS` | **no** | When enabled, store no longer writes the legacy journal blob (`lib/accounting/source-of-truth.ts`) | `lib/accounting/source-of-truth.ts` |
| `ACCOUNTS_EMAIL` | yes | From/Reply-To mailbox for finance e-mails | `app/api/invoices/[id]/send/route.ts` |
| `ACCOUNTS_SMTP_PASS` | yes | SMTP password for the accounts mailbox (secret) | `lib/integrations/email.ts` |
| `ACCOUNTS_SMTP_USER` | yes | SMTP login for the accounts mailbox | `lib/integrations/email.ts` |
| `ANALYZE` | **no** | Enables the Next bundle analyzer (`npm run analyze`) | `next.config.js` |
| `ANTHROPIC_API_KEY` | yes | Anthropic API credential for the DIA assistant (secret) | `lib/jarvis/provider/anthropic.ts` |
| `ANTHROPIC_MODEL` | yes | Anthropic model id for DIA | `lib/jarvis/provider/anthropic.ts` |
| `AUTH_SECRET` | yes | JWT signing secret (alias of `NEXTAUTH_SECRET`) (secret) | `app/api/auth/session-status/route.ts` |
| `AWS_ACCESS_KEY_ID` | **no** | AWS credential (S3 object store / SES fallback) (secret) | `lib/infra/object-store.ts` |
| `AWS_REGION` | **no** | AWS region | `lib/infra/object-store.ts` |
| `AWS_SECRET_ACCESS_KEY` | **no** | AWS credential (secret) | `lib/infra/object-store.ts` |
| `AWS_SES_ACCESS_KEY_ID` | yes | SES credential (secret) | `lib/integrations/email.ts` |
| `AWS_SES_REGION` | yes | SES region | `lib/integrations/email.ts` |
| `AWS_SES_SECRET_ACCESS_KEY` | yes | SES credential (secret) | `lib/integrations/email.ts` |
| `BACKUP_DIR` | **no** | Backup output directory (default `/var/backups/deed-erp`) | `scripts/enrich-restored-repairs-from-backup.mjs` |
| `BLOB_STORE_DIR` | yes | Local blob directory (default `/var/lib/deed-erp/blobs`) | `lib/infra/object-store.ts` |
| `CRON_SECRET` | yes | Shared secret for `/api/cron/*` (secret) | `app/api/cron/sales-inbox-leads/route.ts` |
| `CUSTOMER_PORTAL_SECRET` | yes | Signs customer portal/quote tokens (secret) | `lib/quote-token.ts` |
| `DATABASE_URL` | yes | PostgreSQL connection string (secret); precedence `deed_erp_POSTGRES_URL` > `POSTGRES_URL` > `DATABASE_URL` | `lib/auth/db.ts` |
| `DEED_ENV_FILE` | **no** | Path of the env file used by ops scripts | `lib/security/production-env.ts` |
| `DEED_SKIP_PM2_RELOAD` | **no** | Ops scripts: skip PM2 reload | `app/api/admin/security/env/route.ts` |
| `DEED_WEBSITE_URL` | yes | Public website URL (DIA knowledge ingest, links) | `lib/jarvis/ingest.ts` |
| `DEFAULT_PHONE_COUNTRY_CODE` | yes | Default country code when normalising local phone numbers | `lib/notifications/worker.ts` |
| `E2E_RELAX_RATE_LIMIT` | **no** | Raises the login rate limit for Playwright runs | `lib/rate-limit.ts` |
| `EMAIL_FROM` | yes | Default From address | `app/api/integrations/send-rfq/route.ts` |
| `EMAIL_PROVIDER` | yes | `sendgrid` or `ses` or `smtp` (auto-selects smtp when `SMTP_HOST` is set) | `lib/integrations/email.ts` |
| `GEMINI_API_KEY` | yes | Google Gemini credential (secret) | `app/api/jarvis/voice/status/route.ts` |
| `GEMINI_MODEL` | yes | Gemini model id | `lib/crm/inbox/classify-ai.ts` |
| `GOOGLE_AI_API_KEY` | **no** | Alternate Gemini credential (secret) | `app/api/jarvis/voice/status/route.ts` |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client (Calendar) | `lib/integrations/calendar.ts` |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth secret (secret) | `lib/integrations/calendar.ts` |
| `GOOGLE_REDIRECT_URI` | yes | Google OAuth redirect | `lib/integrations/calendar.ts` |
| `HOME` | **no** | OS variable used by ops scripts | `scripts/download-catalog-photos.ts` |
| `HR_EMAIL` | yes | From/Reply-To mailbox for HR e-mails | `app/api/users/route.ts` |
| `HR_SMTP_PASS` | yes | SMTP password for HR mailbox (secret) | `lib/integrations/email.ts` |
| `HR_SMTP_USER` | yes | SMTP login for HR mailbox | `lib/integrations/email.ts` |
| `HR_TEAM_EMAIL` | yes | Recipient for leave applications | `lib/hr/leave-notifications.ts` |
| `INTERNAL_API_SECRET` | yes | `x-internal-secret` for the 7 internal maintenance routes (secret) | `app/api/admin/backfill-accounting/route.ts` |
| `JARVIS_MODEL` | **no** | Model override for DIA | `lib/crm/inbox/classify-ai.ts` |
| `JARVIS_PROVIDER` | yes | `gemini` or `anthropic` provider selector (template only) | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `LEAVE_APPLY_CC_EMAILS` | yes | CC list for leave applications | `lib/hr/leave-notifications.ts` |
| `LEAVE_NOTIFY_EMAILS` | **no** | Leave notification recipients | `lib/hr/leave-notifications.ts` |
| `MFA_CHALLENGE_SECRET` | yes | Signs MFA challenge cookies (secret) | `lib/auth/mfa.ts` |
| `MFA_ENCRYPTION_KEY` | yes | Encrypts TOTP secrets at rest (secret) | `lib/auth/mfa.ts` |
| `MFA_ENFORCE_PRIVILEGED` | yes | `true` forces MFA for DIR/ADM/FIN | `app/api/admin/security/overview/route.ts` |
| `MPESA_CALLBACK_URL` | yes | Daraja callback URL | `lib/mpesa/config.ts` |
| `MPESA_CONSUMER_KEY` | yes | Daraja credential (secret) | `lib/mpesa/config.ts` |
| `MPESA_CONSUMER_SECRET` | yes | Daraja credential (secret) | `lib/mpesa/config.ts` |
| `MPESA_ENV` | yes | `sandbox` or `production` | `lib/mpesa/config.ts` |
| `MPESA_PASSKEY` | yes | Daraja passkey (secret) | `lib/mpesa/config.ts` |
| `MPESA_SHORTCODE` | yes | Paybill/till number | `lib/mpesa/config.ts` |
| `MPESA_TRANSACTION_TYPE` | yes | STK transaction type | `lib/mpesa/config.ts` |
| `NEXT_DIST_DIR` | **no** | Build output directory (deploy builds into `.next-staging`) | `next.config.js` |
| `NEXT_PUBLIC_APP_URL` | yes | Public app URL (client-visible) | `app/api/users/route.ts` |
| `NEXT_PUBLIC_COMPANY_ADDRESS` | yes | Company address default for documents | `app/portal/quotes/[id]/page.tsx` |
| `NEXT_PUBLIC_COMPANY_EMAIL` | yes | Company e-mail default | `app/portal/quotes/[id]/page.tsx` |
| `NEXT_PUBLIC_COMPANY_NAME` | yes | Company name default | `app/portal/quotes/[id]/page.tsx` |
| `NEXT_PUBLIC_COMPANY_PHONE` | yes | Company phone default | `app/portal/quotes/[id]/page.tsx` |
| `NEXTAUTH_SECRET` | yes | JWT signing secret used by middleware and auth (secret) | `app/api/auth/session-status/route.ts` |
| `NEXTAUTH_URL` | yes | Public base URL; also decides secure-cookie flag | `app/api/auth/logout/route.ts` |
| `NODE_ENV` | yes | `production` in deployment; disables the visual-regression bypass | `app/api/admin/security/env/route.ts` |
| `NOTIFICATION_BATCH_CONCURRENCY` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `NOTIFICATION_WEBHOOK_SECRET` | yes | Shared secret for notification provider webhooks (secret) | `app/api/webhooks/notifications/sendgrid/route.ts` |
| `OBJECT_STORE_ACCESS_KEY_ID` | yes | S3-compatible credential (secret) | `lib/infra/object-store.ts` |
| `OBJECT_STORE_BUCKET` | yes | Bucket | `lib/infra/object-store.ts` |
| `OBJECT_STORE_DIR` | **no** | Local object-store root | `lib/infra/object-store.ts` |
| `OBJECT_STORE_DRIVER` | yes | `fs` (default) or `s3` | `lib/infra/object-store.ts` |
| `OBJECT_STORE_ENDPOINT` | yes | S3 endpoint | `lib/infra/object-store.ts` |
| `OBJECT_STORE_FORCE_PATH_STYLE` | yes | Path-style addressing | `lib/infra/object-store.ts` |
| `OBJECT_STORE_PREFIX` | yes | Key prefix | `lib/infra/object-store.ts` |
| `OBJECT_STORE_REGION` | yes | Region | `lib/infra/object-store.ts` |
| `OBJECT_STORE_SECRET_ACCESS_KEY` | yes | S3-compatible credential (secret) | `lib/infra/object-store.ts` |
| `PARTNER_CORS_ORIGINS` | yes | Allowed origins for the partner API | `lib/partner-api.ts` |
| `PATH` | **no** | OS variable used by ops scripts | `scripts/download-catalog-photos.ts` |
| `PDF_COMPANY_ADDRESS` | yes | Server-side PDF company address (template) | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `PDF_COMPANY_EMAIL` | yes | Server-side PDF company e-mail | `app/api/quotes/send/route.ts` |
| `PDF_COMPANY_NAME` | yes | Server-side PDF company name | `app/api/invoices/[id]/send/route.ts` |
| `PDF_COMPANY_PHONE` | yes | Server-side PDF company phone (template) | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `PDF_LOGO_URL` | yes | Logo URL for PDFs (template) | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `POSTGRES_URL` | yes | Alternate PostgreSQL connection string (secret) | `lib/auth/db.ts` |
| `PROCUREMENT_TEAM_PHONE` | yes | Procurement notification phone | `lib/integrations/notifications.ts` |
| `REDIS_URL` | yes | Self-hosted Redis (cache/queue) | `lib/infra/redis.ts` |
| `REPORT_CACHE_TTL_SECONDS` | yes | Report cache TTL (template) | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `REPORT_SNAPSHOT_TTL_SECONDS` | yes | Report snapshot TTL (template) | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `REPORTING_DATABASE_URL` | yes | Optional read-replica connection for reports (secret) | `lib/infra/report-snapshots.ts` |
| `REPOST_ENDPOINT` | **no** | Ops: endpoint used by the repost helper script | `scripts/repost-orphaned-invoices.mjs` |
| `RETIRE_APP_STATE` | **no** | Gate for retiring legacy `app_state` rows (cutover tooling) | `scripts/transfer-blobs-to-prisma.mjs` |
| `SALES_EMAIL` | yes | From/Reply-To mailbox for sales e-mails | `app/api/quotes/send/route.ts` |
| `SALES_IMAP_HOST` | yes | IMAP host for lead ingestion | `app/api/cron/sales-inbox-leads/route.ts` |
| `SALES_IMAP_MAILBOX` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_IMAP_PASS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_IMAP_PORT` | yes | IMAP port | `app/api/cron/sales-inbox-leads/route.ts` |
| `SALES_IMAP_USER` | yes | IMAP login | `app/api/cron/sales-inbox-leads/route.ts` |
| `SALES_INBOX_AI_CLASSIFIER` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_AUTO_CREATE_ENABLED` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_AUTO_CREATE_THRESHOLD` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_BANK_SENDERS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_BLOCK_DOMAINS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_BLOCK_LOCALS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_CLASSIFIER_VERSION` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_GEMINI_MODEL` | yes | Gemini model for inbox relevance | `lib/crm/inbox/classify-ai.ts` |
| `SALES_INBOX_INTERNAL_DOMAINS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_MODE` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_REVIEW_THRESHOLD` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_INBOX_SUPPLIER_SENDERS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SALES_SMTP_PASS` | yes | SMTP password for sales mailbox (secret) | `lib/integrations/email.ts` |
| `SALES_SMTP_USER` | yes | SMTP login for sales mailbox | `lib/integrations/email.ts` |
| `SALES_TEAM_EMAIL` | yes | Sales team notification recipient | `app/api/portal/quotes/[id]/accept/route.ts` |
| `SECURITY_BASE_URL` | **no** | Target of the post-deploy security smoke | `scripts/security/live-penetration-smoke.mjs` |
| `SECURITY_IP_ALLOWLIST` | **no** | Host audit: allowed SSH source IPs | `app/api/admin/security/overview/route.ts` |
| `SECURITY_ROTATION_CONFIRM` | **no** | Confirmation flag for `rotate-production-secrets.mjs` | `scripts/security/rotate-production-secrets.mjs` |
| `SECURITY_SECRETS_ROTATED_AT` | yes | Date of last secret rotation (checked by deploy verification) | `app/api/admin/security/overview/route.ts` |
| `SECURITY_TEST_EXPECTED_ROLE` | **no** | Smoke test expected role | `scripts/security/live-penetration-smoke.mjs` |
| `SECURITY_TEST_PASSWORD` | **no** | Smoke-test credential (secret) | `scripts/security/live-penetration-smoke.mjs` |
| `SECURITY_TEST_USERNAME` | **no** | Smoke-test user | `scripts/security/live-penetration-smoke.mjs` |
| `SENDGRID_API_KEY` | yes | SendGrid credential (secret) | `lib/integrations/email.ts` |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | yes | Verifies SendGrid event webhooks | `app/api/webhooks/notifications/sendgrid/route.ts` |
| `SETUP_ADMIN_SECRET` | yes | One-time first-admin bootstrap secret — must be removed after use (secret) | `app/api/setup-admin/route.ts` |
| `SMS_MAX_CONCURRENT` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMS_MAX_PER_SECOND` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMS_PROVIDER` | yes | `telerivet` or `twilio` | `lib/notifications/sms-provider.ts` |
| `SMTP_CONNECTION_TIMEOUT_MS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMTP_GREETING_TIMEOUT_MS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMTP_HOST` | yes | SMTP host | `app/api/cron/sales-inbox-leads/route.ts` |
| `SMTP_MAX_CONNECTIONS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMTP_MAX_MESSAGES_PER_CONNECTION` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMTP_PASS` | yes | SMTP password (secret) | `lib/integrations/email.ts` |
| `SMTP_PORT` | yes | SMTP port | `lib/integrations/email.ts` |
| `SMTP_RATE_DELTA_MS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMTP_RATE_LIMIT` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMTP_REQUIRE_TLS` | yes | Require STARTTLS | `lib/integrations/email.ts` |
| `SMTP_SECURE` | yes | Implicit TLS | `lib/integrations/email.ts` |
| `SMTP_SOCKET_TIMEOUT_MS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | yes | TLS certificate verification toggle | `lib/integrations/email.ts` |
| `SMTP_TLS_SERVERNAME` | yes | TLS SNI override | `lib/integrations/email.ts` |
| `SMTP_USER` | yes | SMTP login | `app/api/integrations/send-rfq/route.ts` |
| `STORE_BACKEND` | **no** | `app_state` (default) or `dual` or `prisma` — selects the legacy store location | `lib/store-backend.ts` |
| `TELERIVET_API_KEY` | yes | Telerivet credential (secret) | `lib/notifications/sms-provider.ts` |
| `TELERIVET_HTTP_TIMEOUT_MS` | yes | HTTP timeout | `lib/integrations/telerivet.ts` |
| `TELERIVET_PHONE_ID` | yes | Sending phone id | `lib/integrations/telerivet.ts` |
| `TELERIVET_PROJECT_ID` | yes | Project id | `lib/notifications/sms-provider.ts` |
| `TELERIVET_WEBHOOK_SECRET` | yes | Webhook secret (secret) | `lib/integrations/telerivet.ts` |
| `TWILIO_ACCOUNT_SID` | yes | Twilio account (secret) | `lib/notifications/sms-provider.ts` |
| `TWILIO_AUTH_TOKEN` | yes | Twilio token (secret) | `app/api/webhooks/notifications/twilio/route.ts` |
| `TWILIO_HTTP_TIMEOUT_MS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `TWILIO_PHONE_NUMBER` | yes | Twilio sender | `lib/notifications/sms-provider.ts` |
| `TWILIO_WHATSAPP_NUMBER` | yes | Twilio WhatsApp sender (template) | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `UPLOADS_DIR` | yes | Uploads directory (default `/var/www/deed-erp/.uploads`) | `lib/infra/object-store.ts` |
| `UPSTASH_REDIS_REST_TOKEN` | yes | Upstash token (secret) | `lib/auth/session-validity.ts` |
| `UPSTASH_REDIS_REST_URL` | yes | Upstash REST URL (rate limit/cache) | `lib/auth/session-validity.ts` |
| `VAPID_PRIVATE_KEY` | yes | Web-push private key (secret) | `app/api/notifications/push-test/route.ts` |
| `VAPID_PUBLIC_KEY` | yes | Web-push public key | `app/api/notifications/push-test/route.ts` |
| `VAPID_SUBJECT` | yes | Web-push contact subject | `lib/notifications/web-push.ts` |
| `VISREG_BASE_URL` | **no** | Visual-regression base URL | `scripts/capture-sales-prototypes.mjs` |
| `VISREG_BYPASS_AUTH` | **no** | Dev-only auth bypass; ignored when `NODE_ENV=production` | `app/(app)/layout.tsx` |
| `VISREG_OUT_DIR` | **no** | Screenshot output | `scripts/capture-sales-prototypes.mjs` |
| `VISREG_PASSWORD` | **no** | Visual-regression login (secret) | `scripts/capture-visual-regression.mjs` |
| `VISREG_SKIP_LOGIN` | **no** | Skip login in capture script | `scripts/capture-visual-regression.mjs` |
| `VISREG_USERNAME` | **no** | Visual-regression login | `scripts/capture-visual-regression.mjs` |
| `WHATSAPP_ACCESS_TOKEN` | yes | Meta token (secret) | `lib/integrations/whatsapp.ts` |
| `WHATSAPP_APP_SECRET` | yes | Webhook signature secret (secret) | `app/api/webhooks/notifications/whatsapp/route.ts` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | yes | WhatsApp business account id (template) | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `WHATSAPP_CIRCUIT_COOLDOWN_MS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `WHATSAPP_CIRCUIT_FAILURE_THRESHOLD` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `WHATSAPP_GRAPH_API_VERSION` | yes | Graph API version | `lib/integrations/whatsapp.ts` |
| `WHATSAPP_HTTP_TIMEOUT_MS` | yes | — | (template only — no `process.env.<NAME>` read found by static search; may be read by bracket access) |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | Sender phone-number id | `lib/integrations/whatsapp.ts` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | yes | Webhook verification token (secret) | `app/api/webhooks/notifications/whatsapp/route.ts` |

## 4. Build

```bash
pnpm install --frozen-lockfile     # CI and deploy use pnpm 10 / Node 22 (pnpm-lock.yaml)
npm run build                      # = prisma generate && next build   (NEXT_DIST_DIR=.next-staging is used by the deploy script)
npm run typecheck                  # tsc --noEmit (needs NODE_OPTIONS=--max-old-space-size=4096)
```
- `AGENTS.md` says to install with `npm ci`; at the reviewed commit **`npm ci` fails with `ERESOLVE`** (`next-auth@4.24.15` peer range vs `nodemailer@9`), and `pnpm install --frozen-lockfile` could not complete in the review sandbox because the `xlsx` dependency is fetched from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (blocked by the sandbox proxy with 403). CI succeeds with pnpm. Treat **pnpm + `pnpm-lock.yaml`** as the supported path and `package-lock.json` as stale (KI-24).
- `postinstall` runs `prisma generate`, which needs no database.
- The build needs about 4 GB of Node heap.

## 5. Database migrations

There is **no Prisma Migrate history**. Schema evolves by three mechanisms; all must be understood before changing the schema:

| Mechanism | Used by | Notes |
|---|---|---|
| `prisma db push` | CI (`--accept-data-loss` against a throw-away DB), local disposable DBs | Never run against production |
| Hand-written idempotent SQL in `database/migrations/*_safe.sql` | Production | 45 files; applied as the `postgres` OS role via `scripts/apply-sql-as-postgres.sh` or via the `npm run migrate:*:safe` Node wrappers (`scripts/run-safe-*.mjs`, which print the `sudo -u postgres psql …` fallback and the required `GRANT`s when the app role lacks ownership) |
| Runtime `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` | `app_state`, `users`, counters, MFA tables, … (`lib/server-store.ts`, `lib/auth/users-repository.ts`, `lib/doc-ref-counter.ts`) | Self-healing on first request; requires the app role to own or be allowed to alter those tables |
| Legacy numbered SQL in `prisma/migrations/*.sql` (+2 timestamped dirs) | historical | not a Prisma Migrate history |

**Procedure for a schema change in production**
1. Write an additive, idempotent `database/migrations/<yyyymmdd>_<name>_safe.sql` (no destructive statements; `IF NOT EXISTS`; explicit `GRANT … TO <app role>`), update `prisma/schema.prisma`, add a `scripts/run-safe-<name>.mjs` wrapper and an `npm run migrate:<name>:safe` entry if one is needed.
2. Take and verify a backup (§8).
3. Apply the SQL **before** deploying code that needs it: `scripts/apply-sql-as-postgres.sh database/migrations/<file>.sql`.
4. Deploy (§6). *Caveat:* the CI workflow applies its fixed list of SQL files in a step that runs **after** `deed-erp-deploy.sh`; a code change that needs a new table on first request can therefore start serving before the migration runs. Apply new SQL manually first (KI-23).
5. Verify with the checks in the SQL header (for the state cutover: `SELECT to_regclass('public.store_records'), to_regclass('public.erp_state_keys');`).
6. A failed migration: SQL files are written to be re-runnable; fix the cause and re-run; if a statement partly applied, restore from the pre-migration backup (§9) rather than editing tables by hand.

## 6. Deployment

### 6.1 Automated (GitHub Actions → server)
Trigger: push to `master` or manual dispatch (`.github/workflows/deploy.yml`, concurrency group prevents parallel deploys).
1. `quality` job: `npx tsc --noEmit`, `pnpm test`, `pnpm audit --prod --audit-level high` (two advisories explicitly ignored by id).
2. `e2e` job: Postgres 16 service, `prisma db push --accept-data-loss`, `pnpm build`, Playwright (`smoke`, `critical-workflows`, `security-adversarial`).
3. `deploy` job (needs 1+2; master only), using repository secrets `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`:
   a. Scrub known ops-script copies and generated files from the server worktree so the clean-tree check passes; configure GitHub SSH over port 443.
   b. `/usr/local/bin/deed-erp-deploy.sh` (installed root-owned copy of `scripts/deploy/deed-erp-deploy.sh`).
   c. Apply the fixed list of `database/migrations/*.sql` files, run `fix-coa-blob-alignment.mjs`, `zero-contact-payment-terms.mjs --apply`, `seed-products-final-b974.mjs` (step is named "Seed Final_b974 products" but also performs migrations — idempotent by design).
   d. Verify: production commit is the trigger commit or a descendant; `scripts/security/verify-production-config.mjs` (secrets present/long enough/not placeholders, `MFA_ENFORCE_PRIVILEGED=true`, `SETUP_ADMIN_SECRET` removed, rotation date set); `scripts/security/audit-production-host.sh`; `scripts/security/live-penetration-smoke.mjs` (non-intrusive smoke).

### 6.2 What `deed-erp-deploy.sh` does
Preflight (commands present, `.env` present, current `.next` exists, clean worktree except known ops copies) → **creates and proves a backup** (`deed-erp-backup.sh`; the manifest must show an isolated restore succeeded) → records `previous-commit` and the backup manifest path under `/var/lib/deed-erp/deploy-rollback` → `git fetch` with retries and `git checkout -B` the deploy branch → `pnpm install --frozen-lockfile` → builds into `.next-staging` while `.next` keeps serving → swaps (`.next` → previous, staged → `.next`), carrying previous hashed static assets forward for open tabs → `pm2 startOrReload ecosystem.config.js --update-env` + `pm2 save` → reaps orphaned `next-server` workers → health-checks `http://localhost:3000/login` (24 × 5 s). **Any failure triggers an automatic rollback** of source (`git reset --hard <previous commit>`) and build (previous `.next` restored) and a PM2 restart; the database is never rolled back automatically.

### 6.3 Manual / legacy
`scripts/deploy.sh` (atomic `.next-build` swap, `--rollback` flag, health on `/api/version`, **migrations deliberately not run**) is an older mechanism; prefer the installed `deed-erp-deploy.sh`. Install or update the root-owned copies after reviewing the diff:
```bash
sudo install -m 0750 -o root -g root scripts/backup-db.sh /usr/local/bin/deed-erp-backup.sh
sudo install -m 0750 -o root -g root scripts/verify-backup.sh /usr/local/bin/deed-erp-verify-backup.sh
sudo install -m 0750 -o root -g root scripts/deploy/deed-erp-deploy.sh /usr/local/bin/deed-erp-deploy.sh
```
`scripts/deploy/test-production-safety.sh` exercises the deploy-safety logic.

### 6.4 One-off operations pipeline
23 `ops-*.yml` workflows (`workflow_dispatch`/push) run named maintenance scripts on the server from `ops/*-request.json` files (find/repair/delete repairs, heal delivery qty, undo sale delivery, mark serials sold, set mailbox SMTP, …). They are powerful data-mutation tools triggered through GitHub; the deploy workflow deletes their script copies from the server tree. Review `ops/` request files as production changes.

## 7. Seeding

- **First admin:** set `SETUP_ADMIN_SECRET`, call `POST /api/setup-admin` with header `x-setup-secret` and a strong initial password (refused once any user exists), then **remove `SETUP_ADMIN_SECRET`** (the deploy verification fails while it is set). Do not paste the secret or password into shared logs.
- **Chart of accounts:** `POST /api/accounting/bootstrap-coa` (DIR/FIN/ADM) or SQL `20260828_official_coa_alignment_safe.sql`; `scripts/fix-coa-blob-alignment.mjs`.
- **Products:** `scripts/seed-products-final-b974.mjs` (idempotent by name), `scripts/download-catalog-photos.ts`, `data/catalog-photos/`.
- **Client store seeds** in `lib/store.tsx` are intentionally empty arrays (except departments and default settings/bank-account templates).

## 8. Backups

| Item | Detail |
|---|---|
| Command | `sudo /usr/local/bin/deed-erp-backup.sh` (from `scripts/backup-db.sh`) |
| Output | `/var/backups/deed-erp/<db>_<UTC stamp>_<pid>/` containing `database.dump` (pg_dump custom format), `blobs.tar.gz`, `uploads.tar.gz`, `manifest.json` (UTC timestamps, byte sizes, SHA-256, source commit, client/server versions, `restore_status`, `verified`) |
| Verification | Automatic isolated restore into a temporary database, then drop; on local root deployments uses the `postgres` OS user; `BACKUP_RESTORE_MODE=skip` returns non-zero and records `verified:false` |
| When it runs | **As the first step of every automated deploy.** *A recurring schedule (cron/systemd timer) is not in the repository — unable to verify.* |
| Retention / off-site | No retention policy in the scripts. Off-site copy is only a template (`scripts/ops/srv-003-backup-offsite.sh.example`, "needs credentials", `remediation/IMPLEMENTATION_STATUS.md` lists it as not done) |
| Not covered | Redis, Nginx/PM2 config, `.env` (intentionally excluded from artefacts) |

## 9. Restore and rollback

**Application rollback (automatic on failed deploy; manual otherwise):** `cat /var/lib/deed-erp/deploy-rollback/previous-commit`; `git reset --hard <that commit>`; restore the previous build directory if it still exists (the deploy script keeps one previous `.next`); `pm2 startOrReload ecosystem.config.js --update-env`. Data is untouched.

**Database restore (manual; no script restores into production):**
1. Stop writers: `pm2 stop deed-erp`. 2. Choose the verified backup set (`manifest.json` with `"verified": true`). 3. Restore into a **new** database first (`createdb`, `pg_restore --no-owner --dbname <new> database.dump`), check counts for key tables and `app_state` keys. 4. Swap `DATABASE_URL` or restore over the original during a maintenance window. 5. Restore blobs/uploads from the tarballs to `BLOB_STORE_DIR`/`UPLOADS_DIR` if affected. 6. `pm2 start deed-erp`; check `/api/version`, login, a posted invoice, trial balance. The 2026-09-21 state-cutover incident was recovered this way (`docs/PRISMA_STATE_CUTOVER.md`).

**State-backend rollback:** `STORE_BACKEND=dual` (or unset) + `pm2 reload`; saves made while on `prisma` exist only in the projection and must be copied back first (documented in `docs/PRISMA_STATE_CUTOVER.md`).

## 10. Logging and diagnostics

| Need | How |
|---|---|
| Application logs | `pm2 logs deed-erp`, `pm2 jlist`; route errors are `console.error('[API Error]' …)`; 5xx bodies are masked, details only in logs |
| Request metrics | `lib/http-metrics.ts` (in-memory, per worker) |
| Version / build provenance | `GET /api/version`, `GET /api/store/provenance`, `GET /api/admin/security/provenance`, `lib/deployment-provenance.ts` |
| Nginx | standard `access.log`/`error.log` *(server-side — unverified)* |
| Audit | Director: `/api/admin/audit` (store audit timeline export); DB tables `audit_logs`, `financial_audit_events`, `store_audit_archive` |
| API failure | Reproduce with the same role; check `401` (session/MFA/validity), `403` (role/module/store ACL), `409` (fiscal lock, lockVersion, immutability), `422` (validation), `429` (rate limit); then logs |
| Database failure | `systemctl status postgresql`; `pm2 logs` for `ECONNREFUSED`; check disk; `SELECT 1` via the app role; connection env `DATABASE_URL`/`POSTGRES_URL`/`deed_erp_POSTGRES_URL` precedence (`prisma.config.ts`) |
| Integrity | Finance → Integrity tab / `GET /api/accounting/integrity`; `GET /api/admin/journal-parity`; `GET /api/admin/journal-mirror-failures` (internal secret or DIR); `GET /api/admin/posting-engine-soak` |
| Blob/Prisma parity | `npm run parity:check` (`scripts/check-blob-parity.mjs`); `docs/BLOB_PRISMA_PARITY.md` |

## 11. Operational procedures

### 11.1 Start locally
```bash
pnpm install --frozen-lockfile
VISREG_BYPASS_AUTH=true npm run dev      # real shell, no database, non-production only
# or with a disposable database:
export DATABASE_URL=<disposable postgres url>   # never production
npx prisma db push
npm run dev
```
### 11.2 Run tests
`npm test` (Vitest, whole suite) or `npm test -- --run __tests__/<file>.test.ts`; `npm run test:coverage`; E2E: build, then `npm run test:e2e` (needs `DATABASE_URL`, `NEXTAUTH_SECRET`, optional `E2E_USERNAME/PASSWORD`). `npm run validate:notifications` syntax-checks the notification scripts.
### 11.3 Create a user
Settings → Users (Director): choose an active HR employee; the server derives name/username, generates a temporary password, sets `mustChangePassword`, links the employee and e-mails credentials (`POST /api/users`; `resend-credentials` available). First login forces `/account/password-change` (policy: ≥ 12 chars, upper, lower, digit, special; last 5 hashes blocked).
### 11.4 Assign permissions
Role (8 fixed roles) and module grants (26 modules) are edited on the user (`PATCH /api/users/[id]`, Director). Session version bump/validity cache revokes old tokens. Privileged roles need an authenticator when `MFA_ENFORCE_PRIVILEGED=true`; admin MFA reset: `/api/admin/users/[id]/mfa`. There is no per-permission editor: named permissions are code (`lib/auth/authorization.ts`).
### 11.5 Close a financial period
1. Finance → Integrity: run the suite; fix failures (re-post orphaned invoice journals with `POST /api/accounting/orphaned-invoice-journals`; missing POS journals; parity). 2. Certify: `POST /api/accounting/month-end {"periodEnd":"YYYY-MM-DD"}`. 3. Create the period if absent (`POST /api/accounting/fiscal-periods`) and close it (`POST /api/accounting/fiscal-periods/<id>/close`) — raises the fiscal lock to the period end. **Steps 3 have no UI**; call them from an authenticated browser session (developer-console `fetch`, same-origin) rather than copying cookies into a terminal.
### 11.6 Reopen or correct a transaction safely
- **Never edit posted records or journals directly in SQL.** Correct invoices with credit/debit note or reset-to-draft (only when unpaid) and re-post; correct journals with `reverseJournalEntry` (`REV/<ref>`) then post the corrected entry; manual adjustments with `POST /api/accounting/journals` (DIR/FIN).
- **Locked period:** Director reopens the period with a reason (`POST …/fiscal-periods/<id>/reopen`), then lowers the lock date (`PUT /api/accounting/fiscal-lock {"lockDate":"YYYY-MM-DD","note":…}`) — the two steps are separate and the second is unaudited; record the change in a ticket. Re-close afterwards.
- Take a backup first; record who/why/when outside the system.

### 11.7 Handling failed deployments and migrations
Failed deploy → automatic rollback; read the deploy log, fix, redeploy. Failed health check after swap → rollback restarts the previous build. Failed migration → §5 step 6. Never run `STORE_BACKEND=prisma` without the cutover sequence in `docs/PRISMA_STATE_CUTOVER.md` (backup → create tables → deploy with unset → dry-run backfill → backfill → `dual` for a business day → compare counts → backup → `prisma`).

### 11.8 Scheduled jobs
| Job | Endpoint | Auth | Schedule |
|---|---|---|---|
| Notification worker | `GET/POST /api/cron/notifications` | `CRON_SECRET` or DIR/ADM | server cron *(unverified)*; example in `docs/NOTIFICATION_PLATFORM_DEPLOYMENT.md` |
| Infra worker (snapshots, jobs) | `GET/POST /api/cron/infra` | same | `docs/INFRA_PLATFORM.md` — server cron *(unverified)* |
| Sales inbox → leads | `POST/GET /api/cron/sales-inbox-leads` (+ `sales-inbox-dry-run`) | same | documented as every 5 min via `/etc/cron.d/deed-erp-sales-inbox` *(server-side — unverified)* |
| DIA knowledge ingest | `POST /api/cron/jarvis-knowledge-ingest` | same | on demand/cron *(unverified)* |
| Database backup | `deed-erp-backup.sh` | root | pre-deploy only in repo |
No in-process scheduler exists for these (`setInterval` appears only in client polling and the SSE stream handlers); if the server cron entries are missing the jobs silently do not run.
