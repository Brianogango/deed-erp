# First automation: Inbound sales@ → CRM → notify sales

Status: **V2 live** — relevance filter + triage (junk skipped, weak → Needs review, RFQ → assign + notify).

## Why this one first

Using the 3-question filter (frequency · same steps · delay costs money):

| Question | Answer for sales@ → CRM |
|----------|-------------------------|
| Happens often? | Yes — RFQs hit sales@ throughout the day |
| Same steps? | Yes — fetch → skip noise → create lead → assign → notify |
| Delay costs? | Yes — cold leads / missed quotes |

**Not first:** invoice-paid customer receipts (channels exist; auto-send does not). Do that as automation #2.

## What already runs in production

- Contabo cron every 5 minutes: `/etc/cron.d/deed-erp-sales-inbox` → `POST /api/cron/sales-inbox-leads`
- IMAP poll of `sales@` → CRM `Lead` (`source=inbound_email`)
- Skip internal/auto-replies; dedupe by Message-ID
- Auto-assign (sticky by org + round-robin) when Settings → Auto-assign Leads is on
- In-app bell for the assigned owner
- DIA Actions: `import_sales_inbox_leads` / Insights: `summarize_sales_leads`

## V1 gap closed in this change

Email the **assigned sales rep** (To) and **sales team mailbox** (Cc when different) when a lead is created from IMAP, so reps see RFQs without keeping the ERP open.

## How to operate

```bash
# Dry-run (director session or CRON_SECRET)
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true}' \
  http://127.0.0.1:3000/api/cron/sales-inbox-leads

# Live import
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" -d '{}' \
  http://127.0.0.1:3000/api/cron/sales-inbox-leads
```

Env (Contabo `.env`): `SALES_EMAIL`, `SALES_SMTP_PASS` / `SALES_IMAP_PASS`, `CRON_SECRET`, `SALES_TEAM_EMAIL`, `NEXT_PUBLIC_APP_URL`.

Logs: `/var/log/deed-erp-sales-inbox.log`

CRM: **CRM → Leads** (filter source inbound email). DIA: “Import sales@ leads” / “Summarize email leads”.


## Relevance filter (keep CRM clean)

Three layers work together:

### 1. Mailbox rules (ops — do this first)

CRM only polls **`SALES_IMAP_MAILBOX`** (default `INBOX`). In the sales@ webmail / server:

1. Create folders e.g. `CRM-Ignore`, `Newsletters`, `Vendor-blasts`
2. Add server-side filters: newsletters, known spam senders, internal FYI → move **out of INBOX**
3. Leave real buyer / procurement mail in INBOX

Optional env:

| Env | Purpose |
|-----|---------|
| `SALES_IMAP_MAILBOX` | Folder to poll (default `INBOX`) |
| `SALES_INBOX_BLOCK_DOMAINS` | Extra comma-separated domains to never import |
| `SALES_INBOX_BLOCK_LOCALS` | Extra local-parts to never import (`jobs`, `careers`, …) |

### 2. Hard skip (no lead created)

Already skipped: internal Deed domains, auto-replies / OOO, list-unsubscribe / bulk, undeliverable subjects.

Also skipped now:

- Blocked locals: `noreply`, `newsletter`, `marketing`, …
- Blocked ESP domains: Mailchimp, SendGrid, SES, …
- Promo subjects/bodies: webinar, SEO blast, crypto, “limited time”, …

Skipped messages are marked seen so they are not re-polled.

### 3. Triage vs accept

| Disposition | Stage | Assign + notify |
|-------------|-------|-----------------|
| **accept** (RFQ-shaped: quote/RFQ language, products, qty, corporate domain, attachments, …) | `new` | Yes (when Auto-assign is on) |
| **review** (weak / unclear — e.g. “Hi” from Gmail) | `needs_review` | No — park for human triage in CRM |

CRM → Leads → stage **Needs review**. Promote to New / assign when real.

Cron / DIA import response includes `skipped` and `reviewQueued`.

## Success metrics (lightweight)

- Leads created from `inbound_email` per week
- Time from email received → lead in CRM (should be ≤ 5 min)
- Rep response: open CRM / reply to customer

## Out of scope (later)

- WhatsApp/SMS ping to rep on accept
- Move skipped IMAP mail into a Junk folder automatically
- WhatsApp Business as a lead inbox
- Website form → lead webhook
