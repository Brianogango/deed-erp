# Finance Phase 12 — Domain gaps foundations

**Status:** Additive foundations for previously deferred finance domains. Does **not** enable `ACCOUNTING_POSTING_ENGINE` by default. Does **not** rewrite posted journal history for CoA renumber.

## Domains

| Domain | What shipped | Key paths |
|--------|--------------|-----------|
| Buy-back / trade-in GL | Payout + stock-in builders; `POST /api/trade-in/post-journal`; store `payBuyBack` / `stockBuyBack` fire-and-forget; CoA **1250** trade-in clearing | `lib/accounting/buyback-journals.ts` |
| Analytic accounts / tags / budgets | Prisma models + `/api/accounting/analytics` CRUD + distribution helper | `lib/accounting/analytics.ts` |
| Serial COGS SoT | `resolveSerialCogs` + `processStockDelivery`/`POS` accept `serialIds` → `DeviceSerialCost` | `lib/inventory/serial-cogs.ts`, `valuation-service.ts` |
| OFX/CSV bank import | Parser + `POST /api/bank-statements/import` (persists import + lines, dedupe fingerprint) | `lib/accounting/bank-statement-import.ts` |
| eTIMS / tax / YE 4003 | Tax periods + VAT remittance journal + eTIMS **export log** (no live KRA) + year-end close into **4003** | `tax-periods`, `year-end-close`, `vat-remittance` |
| Partner ledger / ageing → Prisma | `/api/accounting/partner-ledger`, `/api/accounting/ageing`; UI tabs prefer Prisma | `partner-ledger.server.ts`, `ageing.server.ts` |
| CoA renumber | **Display aliases only** (`AccountAlias`); never rewrites posted lines | `lib/accounting/coa-alias.ts`, `/api/accounting/coa-aliases` |
| Cashbook SoT rewrite | Read API `/api/cashbook/entries` over cash CoA journal lines (UI still hybrid; Cashbook.tsx design-hook blocked for import button) | `lib/accounting/cashbook.server.ts` |

## Schema (additive)

`AnalyticAccount`, `AnalyticTag`, `JournalLineAnalytic`, `Budget`, `BudgetLine`, `TaxPeriod`, `EtimsSubmissionLog`, `YearEndClose`, `AccountAlias`, `BankStatementImport`, `BankStatementLine`.

Run on Contabo / staging: `npx prisma db push` (or migrate) before using new APIs.

## Tests

```bash
npm test -- --run __tests__/finance-phase12-domain-gaps.test.ts
```

## Explicitly out / follow-ups

- Live KRA eTIMS submission
- Blind production CoA code rewrite
- Full Cashbook UI rewrite + OFX button (file design-hook blocked — API ready)
- Serial blob (`deed_serials` / `deed_stockMoves`) retirement
- Analytic distribution on every posting line (bridge table ready; not wired into all posters yet)
