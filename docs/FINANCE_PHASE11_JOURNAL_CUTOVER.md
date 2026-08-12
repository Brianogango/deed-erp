# Finance Phase 11 — Journal dual-write + Prisma report SoT

**Status:** Dual-write from store blob journals → Prisma (idempotent `ref`), official Accounting reports Prisma-only, retire still gated. Does **not** set `JOURNAL_WRITERS_MIGRATED` or delete live `deed_journalEntries`. Does **not** enable `ACCOUNTING_POSTING_ENGINE` in production.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Dual-write helper | `lib/accounting/journal-dual-write.ts` | Client fire-and-forget POST with `skipIfExists` |
| Writers flag | `lib/accounting/journal-writers-flag.ts` | `JOURNAL_WRITERS_MIGRATED` (default off) |
| Store | `lib/store.tsx` | `appendPostedJournal` / invoice path queue Prisma persist |
| Journals API | `POST /api/accounting/journals` | Honours `skipIfExists` |
| Retire readiness | `lib/blob-cutover.server.ts` | Reads writers-migrated flag |
| Reports UI | `Accounting.tsx`, Journals/GL tabs | Blob SoT toggles removed; Monthly = operational estimate only |
| Coverage UI | `JournalCutoverCoverage.tsx` | Ref coverage + certify/archive (Accounting → Reports) |

## Dual-write (current)

1. UI/store still appends to blob `deed_journalEntries` (legacy mirror).
2. Same journal is queued to Prisma via `queueJournalPrismaPersist` (`skipIfExists: true`).
3. Official books (journals list, GL, TB, P&L, BS, VAT) read Prisma only.
4. Monthly management report remains operational (invoices/POS/expenses) — labelled as estimate, not official books.

## Retire gate

`retireReady` stays **false** until Finance sets `JOURNAL_WRITERS_MIGRATED=true` after dual-write soak and stops blob journal writers. Certify + archive can proceed when deep ref parity is OK; retire cannot.

## Ops

- Keep `ACCOUNTING_POSTING_ENGINE=false` in production (soak was temporary only).
- Director: Accounting → Reports → Journal ref coverage → Certify / Archive when coverage is 100%.
- Settings → Data Cutover blob panel remains for other keys; journal panel lives on Accounting reports until Settings design-hook unblock.
- Password rotation after any chat paste remains a human ops task.

## Tests

```bash
npm test -- --run __tests__/journal-dual-write.test.ts __tests__/journal-retire-soak.test.ts __tests__/journal-parity.test.ts
```

## Not in this phase

- Full writer cutover / blob key delete
- Buy-back GL, analytic tags/budgets, serial COGS SoT, OFX/CSV, eTIMS, year-end 4003, partner ledger→Prisma, CoA renumber, cashbook SoT rewrite
- Production engine on / Finance UI smoke on Contabo
