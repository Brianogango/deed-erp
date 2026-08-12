# Finance Phase 4 — Inventory valuation & COGS

**Status:** Stock valuation journals (STK) route through the posting engine when flagged. Product average / FIFO / standard costing unchanged. No serial SoT cutover.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| Stock builders | `posting-service.ts` | `buildStockReceiptLines`, `buildStockCogsLines`, `buildStockCustomerReturnLines`, `buildStockVendorReturnLines` |
| `postStockJournal` | `posting-service.ts` | `commitPosting` with `journalCode: 'STK'` |
| Engine wire | `valuation-service.ts` | `persistStockJournal` — flag ON → engine; OFF → `createJournalEntry` |
| CoA roles | `resolveStockAccounts` | `inventory` → **1200**, `cogs` → **6001** (via `labelForRole`); GRNI stays **3201** |

## Behaviour

- **Flag OFF:** same STK journals via `createJournalEntry` (idempotent refs / valuation events unchanged).
- **Flag ON:** same lines → `postStockJournal` → balance check + fiscal lock + idempotent ref.
- Receipts: Dr Inventory (+ price variance) / Cr GRNI **3201**.
- Delivery / POS: Dr COGS / Cr Inventory at product avg (or FIFO/standard).
- **Serial cost:** still product-level average — serial SoT cutover is out of scope (documented limitation).

## Tests

```bash
npm test -- --run __tests__/stock-valuation-posting.test.ts __tests__/accounting-foundation.test.ts __tests__/accounting-posting-engine.test.ts
```

## Not in this phase

- Serial-level COGS / `DeviceSerialCost` for sales
- Retiring `deed_serials` / `deed_stockMoves`
- Reconfiguration journals onto the engine
- Warehouse transfer valuation
- Bank statement matching (Phase 5)
