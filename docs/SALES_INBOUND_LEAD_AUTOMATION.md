# First automation: Inbound sales@ → CRM → notify sales

Status: **V1 shipping** (pipeline already live; email alert added).

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

## Success metrics (lightweight)

- Leads created from `inbound_email` per week
- Time from email received → lead in CRM (should be ≤ 5 min)
- Rep response: open CRM / reply to customer

## Out of scope (later)

- WhatsApp/SMS ping to rep
- Invoice paid → automatic customer receipt (automation #2)
- WhatsApp Business as a lead inbox
- Website form → lead webhook
