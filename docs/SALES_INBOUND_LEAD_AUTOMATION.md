# First automation: Inbound sales@ → CRM → notify sales

Status: **V3 foolproof pipeline** — idempotency, hard exclusions, thread resolution,
intent classification (money ≠ lead), contact match, confidence bands, review queue.

## Why this one first

Using the 3-question filter (frequency · same steps · delay costs money):

| Question | Answer for sales@ → CRM |
|----------|-------------------------|
| Happens often? | Yes — RFQs hit sales@ throughout the day |
| Same steps? | Yes — fetch → skip noise → create lead → assign → notify |
| Delay costs? | Yes — cold leads / missed quotes |

## Pipeline (V3)

```
IMAP message
  → Idempotency (provider message id unique)
  → Normalize (email / phone / subject / clean body / thread id)
  → Hard exclusion (bank / payment / marketing / internal…)
  → Thread resolution (one active lead per provider thread)
  → Sales-intent classification (rules; AI optional later)
  → Confidence: auto ≥0.90 · review 0.75–0.89 · else ignore
  → Contact resolution (exact email/phone; enrich only empty fields)
  → Create lead / link thread / needs_review / skip
  → Audit row in sales_inbound_emails
```

**Invariants**

1. Presence of money does not imply sales intent.
2. Buying intent can exist without an amount.
3. Exact normalized email reuses the existing Client.
4. Same provider message never processed twice.
5. One provider thread → at most one active lead (unless human splits).
6. Classifier failure → `REVIEW_REQUIRED`, never auto-lead.
7. Conflicting contact data is not silently overwritten.

## What runs in production

- Contabo cron every 5 minutes: `/etc/cron.d/deed-erp-sales-inbox` → `POST /api/cron/sales-inbox-leads`
- IMAP poll of `sales@` → CRM `Lead` (`source=inbound_email`)
- Auto-assign (sticky by org + round-robin) when Settings → Auto-assign Leads is on **and** disposition is auto-create
- In-app bell + email for the assigned owner
- DIA Actions: `import_sales_inbox_leads` / Insights: `summarize_sales_leads`

## How to operate

```bash
# Dry-run (director session or CRON_SECRET) — no CRM mutation from pipeline creates
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true}' \
  http://127.0.0.1:3000/api/cron/sales-inbox-leads

# Live import
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" -d '{}' \
  http://127.0.0.1:3000/api/cron/sales-inbox-leads
```

Apply DB migration (additive):

```bash
cd /var/www/deed-erp
DATABASE_URL=… node scripts/run-safe-sales-inbound-email-pipeline.mjs
```

## Configuration

| Env | Purpose |
|-----|---------|
| `SALES_IMAP_*` | Mailbox connection |
| `SALES_INBOX_MODE` | `shadow` \| `review` \| `auto` |
| `SALES_INBOX_AUTO_CREATE_THRESHOLD` | Default `0.9` |
| `SALES_INBOX_REVIEW_THRESHOLD` | Default `0.75` |
| `SALES_INBOX_AUTO_CREATE_ENABLED` | Default `true` |
| `SALES_INBOX_BLOCK_DOMAINS` / `SALES_INBOX_BLOCK_LOCALS` | Extra hard skips |
| `SALES_INBOX_INTERNAL_DOMAINS` | Deed-controlled domains |
| `SALES_INBOX_BANK_SENDERS` / `SALES_INBOX_SUPPLIER_SENDERS` | Known domains |
| `CRON_SECRET` | Cron auth |
| `SALES_TEAM_EMAIL` | Cc / fallback notify |

Logs: `/var/log/deed-erp-sales-inbox.log`

CRM: **CRM → Leads** (stage **Needs review** for medium confidence / conflicts).

## Disposition matrix

| Decision | Stage | Assign + notify |
|----------|-------|-----------------|
| HARD_FILTERED / NON_SALES | none | no |
| LINK_EXISTING_LEAD | existing | no (notes appended) |
| REVIEW_REQUIRED | `needs_review` | no |
| LEAD_CREATED | `new` | yes when Auto-assign on |
| SHADOW_RECORDED | none | no (classification only) |

## Tests

`npm test -- --run __tests__/sales-inbox-pipeline.test.ts`

Covers RFQ, bank/payment/marketing false positives, thread reuse, email/phone match,
enrichment vs conflict, prompt-injection ignore, AI failure → review, shadow mode.

## Remaining (Phase 2)

- Optional Gemini structured classifier behind the same confidence policy
- Dedicated CRM Email Review UI (today: Needs review stage + audit note)
- Duplicate Contacts review board
- Attachment text extraction for RFQ.pdf
- Historical dry-run report job against mailbox sample
