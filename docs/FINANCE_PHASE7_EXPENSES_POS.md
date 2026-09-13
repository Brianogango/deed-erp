# Finance Phase 7 — Expenses / POS edge GL

**Status:** Expense approval/payment/reimbursement and POS sale post to the Prisma GL through the central posting service. Posting is no longer skipped when the legacy feature flag is off. POS journal and audit commit atomically. Blob retirement remains a separate certified cutover.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Account helpers | `lib/accounting/expense-pos-accounts.ts` | Category → expense label; bank id/method → cashbook labels (2210/2201/…) |
| Builders | `posting-service.ts` | `buildExpenseApprovalLines`, `buildExpenseReimbursementLines`, `buildPosSaleLines` |
| Post helpers | `posting-service.ts` | `postExpenseApproval` (`JRN/EXP/…`), `postExpenseReimbursement` (`JRN/RIM/…`), `postPosSale` (`JRN/<POS>`) |
| Expense API | `POST /api/expenses/post-journal` | Finance seal; `kind: approval \| reimbursement` |
| POS API | `POST /api/pos/post-sale-journal` | POS roles; revenue line buckets optional |
| Store wire | `lib/store.tsx` | Blob journals unchanged; fire-and-forget engine APIs after post |

## Behaviour

- The APIs always commit to Prisma GL through `commitPosting`; they never return a feature-flag skip.
- All postings require an explicit valid date and pass the fiscal lock.
- Expense approval credits **3105** for reimbursements or outstanding payments for company-funded claims; payment clears the payable to bank.
- POS posts Dr tender/customer credit (+ loyalty discount) and Cr revenue (+ **3301** VAT) in the same transaction as its financial audit.
- Expense UI and POS session/cart flow unchanged.

## Tests

```bash
npm test -- --run __tests__/expense-pos-posting.test.ts __tests__/accounting-posting-engine.test.ts
```

## Not in this phase

- Buy-back / trade-in GL completeness
- Retiring the archived blob journal key before certified parity
- Analytic dimensions, which are delivered separately
- Analytic tags on expense lines (Phase 8)
