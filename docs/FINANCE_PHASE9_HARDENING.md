# Finance Phase 9 — Hardening & journal certify readiness

**Status:** Deep journal parity by **ref** (blob ⊆ Prisma) + certify gate + report SoT banner. Does **not** retire `deed_journalEntries` or enable the posting engine by default.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Pure helpers | `lib/accounting/journal-parity.ts` | Ref sets, amount-drift sample, `evaluateJournalDeepParity` |
| Cutover wire | `lib/blob-cutover.server.ts` | `deed_journalEntries` uses `allowPrismaAhead` + deep ref check |
| API | `GET /api/admin/journal-parity` | Finance/Director read-only deep report + certificate |
| UI | Accounting → Reports | Provisional vs certified SoT banner |
| Docs / tests | this file + `__tests__/journal-parity.test.ts` | |

## Behaviour

- **Identity key:** journal `ref` (not blob `id`). Prisma-only journals (STK / FX / reconfig / engine) are expected ahead of blob.
- **Certify gate:** `POST /api/admin/blob-cutover` `{ action: "certify", blobKey: "deed_journalEntries" }` requires deep parity OK (every blob ref in Prisma + sampled totals match). Count equality alone is not enough.
- **Report banner:** Prisma reports stay usable; banner shows provisional until journals are certified.
- `ACCOUNTING_POSTING_ENGINE` remains **off** by default.

## Tests

```bash
npm test -- --run __tests__/journal-parity.test.ts __tests__/currency-pricelists-cutover.test.ts
```

## Not in this phase

- Retiring / deleting live `deed_journalEntries`
- Enabling the posting engine in production
- Removing blob report toggles or Monthly Management Report
- Certifying products / invoices / serials
- CoA renumber or year-end close
