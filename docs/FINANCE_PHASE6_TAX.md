# Finance Phase 6 — Tax / VAT control

**Status:** GL-backed VAT control report (3301 / 1150) + return draft DTO. No eTIMS / multi-jurisdiction engine.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Pure helpers | `lib/accounting/vat-reports.ts` | `buildVatControlFromAggregates`, `buildVatControlFromInvoices`, `buildVatReturnDraft` |
| Server report | `lib/accounting/vat-reports.server.ts` | `buildVatControlReport` from posted journal lines |
| API | `GET /api/accounting/vat-control` | `dateFrom` / `dateTo`; `draft=1` includes return draft + company PIN |
| Hook | `usePrismaAccountingReports` `vatControl` flag | Fetches Prisma VAT control |
| UI | Accounting → VAT tab | Source toggle: Prisma GL (default) vs blob invoice sums |

## Behaviour

- **Prisma GL (default):** Output VAT = net credit on **3301**; Input VAT = net debit on **1150**; payable = output − input. Includes credit-note reversals reflected in journals.
- **Blob fallback:** Previous behaviour (Σ `taxTotal` on posted invoices/bills).
- Read-only — does **not** require `ACCOUNTING_POSTING_ENGINE` (engine still ensures role-labeled VAT postings when on).

## Tests

```bash
npm test -- --run __tests__/vat-reports.test.ts
```

## Not in this phase

- eTIMS / KRA filing integration
- Multi-rate / multi-jurisdiction tax engine
- Dedicated tax period workflow table
- Automatic VAT remittance journals
