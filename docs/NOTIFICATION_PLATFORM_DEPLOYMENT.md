# Deed ERP Notification Platform — Production Deployment

This subsystem moves business notifications out of browser/app_state blobs and into PostgreSQL with an outbox, recipient ledger, channel deliveries, attempts, retries, dead letters, provider callbacks, preferences, escalation and Web Push.

## 1. Database migration

Apply the non-destructive foundation before deploying code that reads the relational notification tables:

```bash
cd /var/www/deed-erp
node scripts/run-safe-notification-platform.mjs
npx prisma generate
```

The migration does **not** delete `deed_notifications` or `deed_documentEmailSends` from `app_state`. They remain available during the cutover window.

Backfill legacy bell notifications once:

```bash
node scripts/backfill-notifications-to-prisma.mjs
```

The backfill uses stable idempotency keys, so rerunning it is safe.

## 2. Web Push

Generate VAPID keys:

```bash
node scripts/generate-vapid-keys.mjs
```

Put the generated values in the production `.env`:

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:info@deed.co.ke
```

Users can then enable Browser Push from **Account Settings → Notification Channels**.

## 3. Notification worker

The worker endpoint is:

```text
POST /api/cron/notifications
Authorization: Bearer $CRON_SECRET
```

Run it at least once per minute in production. The endpoint:

1. scans operational conditions,
2. writes idempotent events,
3. routes outbox events,
4. dispatches due channel deliveries,
5. processes acknowledgement escalations.

Example systemd/cron invocation:

```bash
curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://erp.deed.co.ke/api/cron/notifications
```

Do not configure a cadence faster than the infrastructure can sustain. The database uses `FOR UPDATE SKIP LOCKED`, so overlapping workers do not process the same due row concurrently.

## 4. Provider callbacks

Configure provider callbacks to the public HTTPS ERP domain.

### WhatsApp Cloud API

Verification/callback URL:

```text
https://erp.deed.co.ke/api/webhooks/notifications/whatsapp
```

Set:

```text
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<random verification token>
WHATSAPP_APP_SECRET=<Meta app secret>
```

The POST route verifies `X-Hub-Signature-256` before accepting delivery/read statuses.

### Twilio SMS

Status callback URL:

```text
https://erp.deed.co.ke/api/webhooks/notifications/twilio
```

The route validates `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN`.

### SendGrid

Event Webhook URL:

```text
https://erp.deed.co.ke/api/webhooks/notifications/sendgrid
```

Preferred configuration uses SendGrid signed event-webhook verification through `SENDGRID_WEBHOOK_PUBLIC_KEY`. `NOTIFICATION_WEBHOOK_SECRET` is available only as a controlled fallback.

### Amazon SES

Publish SES delivery/bounce/complaint events to SNS and subscribe:

```text
https://erp.deed.co.ke/api/webhooks/notifications/ses
```

The endpoint validates the SNS certificate/signature and supports subscription confirmation.

## 5. SMTP hardening

Production SMTP uses pooled connections with certificate verification and bounded timeouts. Recommended baseline:

```text
SMTP_REQUIRE_TLS=true
SMTP_TLS_REJECT_UNAUTHORIZED=true
SMTP_CONNECTION_TIMEOUT_MS=10000
SMTP_GREETING_TIMEOUT_MS=10000
SMTP_SOCKET_TIMEOUT_MS=30000
SMTP_MAX_CONNECTIONS=3
SMTP_MAX_MESSAGES_PER_CONNECTION=100
SMTP_RATE_DELTA_MS=1000
SMTP_RATE_LIMIT=8
```

Do not permanently set `SMTP_TLS_REJECT_UNAUTHORIZED=false`. Correct the certificate or SMTP hostname instead.

## 6. SMS and WhatsApp protection

Recommended baseline:

```text
WHATSAPP_HTTP_TIMEOUT_MS=10000
WHATSAPP_CIRCUIT_FAILURE_THRESHOLD=5
WHATSAPP_CIRCUIT_COOLDOWN_MS=60000
TWILIO_HTTP_TIMEOUT_MS=10000
SMS_MAX_CONCURRENT=2
SMS_MAX_PER_SECOND=1
NOTIFICATION_BATCH_CONCURRENCY=4
```

WhatsApp upstream 429/5xx/network failures open a short process-local circuit after repeated failures. Durable delivery retries remain in PostgreSQL.

## 7. Operations

Administrators can inspect the platform at:

**Settings → Notifications**

The panel exposes delivery counts, channel volume, pending outbox/delivery counts, current dead letters and recent failures. Dead-letter deliveries can be requeued from the panel.

User-level delivery preferences are under:

**Account Settings → Notification Channels**

Critical policy events can bypass quiet hours or disabled optional channels where the event registry marks them mandatory.

## 8. Cutover verification

Before production enablement, verify:

```bash
npx prisma generate
npm run typecheck
npm test
npm run build
```

Then exercise:

- new inbound CRM lead,
- leave application and approval,
- salary advance application and decision,
- customer invoice payment,
- repair ready notification,
- WhatsApp status callback,
- Twilio status callback,
- browser push subscription,
- dead-letter manual retry.

Confirm each business action leaves an event in `notification_events` and channel work in `notification_deliveries`.

## 9. Rollback

Application rollback does not require deleting notification data. The migration is additive. If code is rolled back, the legacy app_state blobs remain untouched unless explicitly removed later.

Do not drop notification tables during an incident. Stop the notification worker first, roll back application code, investigate failed/dead-letter deliveries, then resume after correction.
