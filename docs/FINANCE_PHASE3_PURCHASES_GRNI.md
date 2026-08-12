# Finance Phase 3 — Purchases / GRNI / 3-way match

**Status:** Vendor bills on the posting engine (flag-gated); server 3-way match on bill post; Input VAT in CoA role map. No full PO blob cutover.

## What this adds

| Piece | Path | Role |
|-------|------|------|
| `input_vat` → **1150** | `coa-roles.ts` + CoA template | Map Input VAT (was hardcoded only in vendor-bill builders) |
| Role labels on bill lines | `vendor-bill-perpetual.ts` | AP / Input VAT / GRNI via `labelForRole` |
| `postVendorBill` | `posting-service.ts` | Engine commit for vendor bill/credit journals |
| Engine wire | `invoice-journals.ts` | Vendor branch uses engine when `ACCOUNTING_POSTING_ENGINE=true` |
| 3-way helpers | `three-way-match.ts` | `assertVendorBillThreeWayMatch`, `summarizePoThreeWayMatch` |
| Server gate | `assert-bill-match.server.ts` + invoice PUT | Blocks posting vendor bill when qty > received − billed |

## GRNI account

Live role `grni` remains **3201 Accruals** (map, do not renumber). GRN valuation still posts Dr Inventory / Cr **3201**; vendor bills clear GRNI on that account when perpetual valuation is on.

## Behaviour

- **Flag OFF:** vendor bill journals still go through `persistStoreJournalEntry` (same lines; role labels identical).
- **Flag ON:** same builders → `postVendorBill` → `commitPosting`.
- **3-way:** on draft → posted for `vendor_bill` with `purchaseOrderId`, server loads blob PO and asserts billable qty per product. Returns **409** on over-bill.
- PO / receipts remain **blob_sot**; this phase does not retire them.

## Tests

```bash
npm test -- --run __tests__/vendor-bill-perpetual.test.ts __tests__/three-way-match.test.ts __tests__/accounting-posting-engine.test.ts
```

## Not in this phase

- Full `deed_purchaseOrders` / `deed_receipts` SoT cutover
- Moving STK/`processStockReceipt` onto the posting engine
- Dedicated new GRNI code (keep **3201** until Finance signs a renumber/map change)
- Tax periods / VAT returns (Phase 6)
