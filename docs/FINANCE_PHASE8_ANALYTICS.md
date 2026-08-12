# Finance Phase 8 — Analytics / management P&L

**Status:** Period-scoped management P&L from posted Prisma GL (CoA groups). Analytic tags / budgets deferred. Blob Monthly report remains operational estimate only.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Classifiers + builder | `lib/accounting/management-pl.ts` | COGS / opex / finance buckets; gross + net |
| Server wire | `gl-reports.ts` `buildManagementProfitAndLoss` | Fetches posted lines + aggregates |
| API | `GET /api/accounting/profit-loss` | `view=management` (default) or `flat`; `dateFrom` / `dateTo` |
| Hook | `usePrismaAccountingReports` | Passes period + view query params |
| UI | Accounting → P&L | Period controls; management sections when Prisma |

## Behaviour

- **Prisma (default):** Revenue → Other income → Total income → COGS → Gross profit → Operating → Finance → Net. Classification uses `accountGroup` / `subGroup` (with code-range fallbacks).
- **Flat view:** Previous all-expense list via `?view=flat`.
- **Blob toggle:** Legacy invoice/bill/expense estimate unchanged.
- Read-only — does **not** require `ACCOUNTING_POSTING_ENGINE`.

## Classification (expense)

| Bucket | CoA groups / signals |
|--------|----------------------|
| COGS | Direct Expenses, Local/Import Purchases, `subGroup=COGS`, codes `60xx`/`61xx` |
| Finance | Finance Costs / Financial Expenses, `6401` |
| Operating | Operating / Employment Expenses, other `62–69xx` |

## Tests

```bash
npm test -- --run __tests__/management-pl.test.ts __tests__/gl-reports.test.ts
```

## Not in this phase

- Analytic account / tag / budget schema
- Tagging expense/POS lines at posting time
- Retiring blob Monthly Management Report
- Partner ledger / ageing → Prisma
- Year-end close into **4003** Current Year P&L
