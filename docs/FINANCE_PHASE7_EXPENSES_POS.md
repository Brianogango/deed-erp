# Finance Phase 7 — Expenses / POS edge GL

**Status:** Expense approve/reimburse and POS sale dual-write through the posting engine when flagged. Blob journals remain SoT. Buy-back / trade-in deferred. No Cashbook or POS UI rewrite.

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

- **Flag OFF:** blob expense/POS journals only; APIs return `{ skipped: true }`.
- **Flag ON:** same refs/lines as blob → engine (`commitPosting`) → Prisma GL (idempotent on ref). Approvals credit **3105** (reimbursement) or bank; reimbursements Dr **3105** / Cr bank; POS Dr tender (+ loyalty) / Cr revenue (+ **3301** VAT).
- Expense UI and POS session/cart flow unchanged.

## Tests

```bash
npm test -- --run __tests__/expense-pos-posting.test.ts __tests__/accounting-posting-engine.test.ts
```

## Not in this phase

- Buy-back / trade-in GL completeness
- Migrating `deed_expenses` / POS orders off blob
- Cashbook SoT rewrite
- Analytic tags on expense lines (Phase 8)
