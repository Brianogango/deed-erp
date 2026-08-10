# Automation #2: Invoice paid → customer confirmation

Status: **V1 live** (email + WhatsApp when phone exists).

## Why this one second

| Filter | Invoice payment receipt |
|--------|-------------------------|
| Happens often? | Yes — every AR collection |
| Same steps? | Yes — payment recorded → confirm to customer |
| Delay costs? | Yes — “did you get my M-PESA?” follow-ups |

Automation #1 (sales@ → CRM) protects inbound leads. This one closes the cash loop.

## Behaviour

On **new** payment via `POST /api/invoices/[id]/payments` (UI Pay, credit apply, portal M-PESA approve):

1. Skip if this payment id already has a successful `payment_receipt` send log
2. Resolve client email / phone from Prisma `Client`
3. Email via **accounts** mailbox (required when email present)
4. WhatsApp when phone present (best-effort)
5. Log to `deed_documentEmailSends` (`documentType=payment_receipt`, `documentId=paymentId`)
6. **Never** fail the payment if messaging fails
7. Idempotent payment retries (`idempotent: true`) do **not** re-notify

## Message content

- Amount, method, reference, date
- Invoice total, amount paid to date, balance or “paid in full”

## Out of scope (later)

- PDF receipt attachment / RCT numbering UI
- Auto-send from `POST /api/payments` multi-allocation bulk path (single-invoice path covers normal UI)
- M-PESA Daraja auto-capture
- Vendor bill payments
