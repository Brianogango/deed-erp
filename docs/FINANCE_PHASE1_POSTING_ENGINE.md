# Finance Phase 1 — Central posting engine

**Status:** Feature-flagged strangler. Default **OFF**.  
**Flag:** `ACCOUNTING_POSTING_ENGINE=true` (also `1` / `on` / `yes`)

## What this adds

| Piece | Path | Role |
|-------|------|------|
| CoA role map | `lib/accounting/coa-roles.ts` | Guide concepts → live codes (AR **1800**, AP **3000**, GRNI **3201**, VAT **3301**, …). Map, do not renumber. |
| Feature flag | `lib/accounting/posting-flag.ts` | Gate for engine path |
| Posting engine | `lib/accounting/posting-service.ts` | Typed builders + `commitPosting` → `persistStoreJournalEntry` (balance check, fiscal lock, idempotent ref) |
| Residual helper | `lib/accounting/money.ts` | `invoiceResidual(total, allocated)` used by payment allocations |
| Wire-up | `lib/accounting/invoice-journals.ts` | When flag ON: customer invoice post + all invoice payment journals use the engine |

## Behaviour

- **Flag OFF (default):** Same operational path as before (`persistStoreJournalEntry` from invoice-journals). Labels still resolve via the role map where hardcoded strings were replaced (identical strings).
- **Flag ON:** `postInvoiceJournalToPrisma` (customer invoices) and `postInvoicePaymentJournalToPrisma` call `postCustomerInvoice` / `postInvoicePayment`.
- Vendor bill perpetual builders are unchanged except GRNI label is sourced from the role map.
- Blob dual-write is unchanged — engine only affects the Prisma journal commit path already used by invoice-journals.

## Enable (staging / Contabo)

```bash
# in application .env (never commit secrets)
ACCOUNTING_POSTING_ENGINE=true
```

Restart the Node process (PM2) after changing the flag. Smoke: post a customer invoice and a payment; confirm `journal_entries` refs `JRN/<inv>` and `JRN/PAY/...` and balanced lines on 1800 / 5000 / 3301 / bank.

## Tests

```bash
npm test -- --run __tests__/accounting-posting-engine.test.ts __tests__/payment-allocations.test.ts
```

## Not in this phase

- Outstanding receipt/payment documents
- Stock / valuation / expense / POS migration onto the engine
- CoA renumber or report SoT cutover
- Enabling the flag in production by default

See also: Phase 0 gap matrix (`docs/FINANCE_PHASE0_GAP_MATRIX.md` when merged).
