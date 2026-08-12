# Finance Phase 5 — Bank & cash / statement matching

**Status:** Extracted match helpers; bank charge/interest GL via posting engine; outstanding payment suggestions for statement lines. No OFX/CSV feed. Blob bank recon remains SoT.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Match helpers | `lib/accounting/bank-statement-match.ts` | `scoreStatementCashbookMatch`, `autoMatchStatementLines`, `suggestOutstandingPaymentMatches` |
| Store wire | `lib/store.tsx` `autoMatchStatements` | Delegates to pure helper (same tolerances: ±1 KES, ≤5 days) |
| CoA roles | `bank_charges` **6401**, `interest_income` **5105** | Additive map + CoA template |
| Builders + post | `buildBankChargeLines`, `buildBankInterestLines`, `postBankStatementAdjustment` | Engine `BNK` journals |
| Post adjustments | `POST /api/bank-recon/adjustments` | Finance seal + engine flag required |
| Suggest outstanding | `POST /api/bank-recon/suggest-outstanding` | Match statement ↔ Phase 2 unallocated payments |

## Behaviour

- **Flag OFF:** Cashbook recon UI unchanged; auto-match uses shared helper; no new bank fee JE API success (409 if called).
- **Flag ON:** Finance can post unmatched `bank_charge` / `interest_earned` lines to GL (Dr 6401 / Cr bank, or Dr bank / Cr 5105).
- Outstanding clear still happens via payment allocations; this phase **suggests** which outstanding Prisma payment fits a statement line (direction + amount + date).

## Tests

```bash
npm test -- --run __tests__/bank-statement-match.test.ts
```

## Not in this phase

- OFX/CSV/MT940 import UI
- Migrating `deed_bank*` off blob
- Full cashbook SoT → Prisma payments
- Tax engine (Phase 6)
