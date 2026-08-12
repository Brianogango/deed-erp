# Finance Phase 2 — Outstanding receipts/payments & residuals

**Status:** Data + API support for unallocated cash; outstanding clearing GL when Phase 1 engine flag is on.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Residual helpers | `lib/accounting/residuals.ts` | `paymentUnallocated`, allocation state |
| Allocation math | `lib/accounting/payment-allocations.ts` | Allow under-allocation / empty allocations; allocate against remaining ceiling |
| CoA clearing | `1805` Outstanding Receipts · `3005` Outstanding Payments | Role map + CoA template (additive — not a renumber) |
| Posting builders | `posting-service` `buildPaymentWithOutstandingLines` / `buildAllocateOutstandingLines` | Used when `ACCOUNTING_POSTING_ENGINE=true` |
| Create payment | `POST /api/payments` | `allocations` may sum to **≤** amount; empty/`outstanding:true` = fully unallocated |
| List outstanding | `GET /api/payments?outstanding=1` | Prisma payments with unallocated > 0 |
| Allocate later | `POST /api/payments/[id]/allocations` | Apply remaining outstanding onto invoices/bills |

## Behaviour

- Invoice payment progress remains **derived** (`invoicePaymentStatus` / residual) — not a stored PAID flag.
- **Flag OFF:** journals still post only for allocated slices (legacy per-invoice Dr Bank / Cr AR). Unallocated is tracked on the payment row until allocated.
- **Flag ON:** create posts Dr Bank (full) / Cr AR (allocated) / Cr **1805** (remainder). Later allocate posts Dr **1805** / Cr AR. Vendor outbound uses **3005**.

### Create examples

```http
POST /api/payments
{ "amount": 10000, "paymentMethod": "bank_transfer", "partnerName": "Acme",
  "allocations": [{ "invoiceId": "…", "amount": 6000 }] }
→ unallocatedAmount: 4000

POST /api/payments
{ "amount": 5000, "outstanding": true, "partnerName": "Acme", "allocations": [] }
→ fully outstanding receipt
```

### Allocate remainder

```http
POST /api/payments/{id}/allocations
{ "allocations": [{ "invoiceId": "…", "amount": 4000 }] }
```

## Deploy note

New CoA codes **1805** / **3005** are in the bootstrap template. Existing Contabo CoA may need a one-time account create (or re-bootstrap) before enabling the posting engine for outstanding flows. App-user journal auto-create stubs still prevent hard failures.

## Tests

```bash
npm test -- --run __tests__/accounting-outstanding-residuals.test.ts __tests__/payment-allocations.test.ts
```

## Not in this phase

- Bank statement line matching
- Full UI for outstanding cash desk
- Tax engine / stock posting migration
