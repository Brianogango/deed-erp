# Blob → Postgres cutover (no blob SoT)

**Goal:** Every operational domain is written to Prisma/Postgres. Blobs may remain as read caches until certified and archived — never deleted without a parity certificate.

**Date started:** 2026-08-06  
**Branch:** `cursor/blob-cutover-deliveries-ddc8`

## Sequencing

| Phase | Domain | Status |
|-------|--------|--------|
| 1 | **Deliveries** (`deed_deliveries` → `delivery_notes`) | **In progress** — SO-first schema + dual-write mirror |
| 2 | Serials (`deed_serials` → `serial_numbers`) | Next |
| 3 | Stock moves (`deed_stockMoves` → `stock_movements`) | Next |
| 4 | PO + GRN (`deed_purchaseOrders`, `deed_receipts`) | After 2–3 |
| 5 | Retire dual-write mirrors (SO/invoice/quote blobs as cache-only, then archive) | Last |

## Phase 1 — Deliveries (this PR)

### Schema blocker fixed
- `DeliveryNote.invoiceId` is now **nullable** (SO → DN → Invoice order)
- Added `saleOrderId`, `blobId`, recipient/prepare fields, line `qtyDone` + `serialIds[]`
- Empty-table migration: `database/migrations/20260806_delivery_notes_so_first.sql`

### Dual-write
- `lib/inventory/delivery-mirror.ts` upserts on every `deed_deliveries` save
- Hooked from `lib/server-store.ts` `saveStoreKeys`
- Catalog: `deed_deliveries` moved from `BLOB_SOT` → `DUAL_WRITE`

### Backfill
```bash
# After schema applied on Contabo:
cd /var/www/deed-erp
node scripts/backfill-deliveries-to-prisma.mjs
```

### Not yet
- UI/API still **reads** from blob (SoT for reads until parity soak)
- Stock mutation still blob-driven on validate
- Certify/archive of `deed_deliveries` after counts converge

## Absolute rules
1. Verified backup before any production schema change  
2. Additive dual-write first; never blind-delete `deed_*`  
3. Certify via `/api/admin/blob-cutover` + `scripts/check-blob-parity.mjs`  
4. One domain at a time  

## Next slice after merge/deploy of Phase 1
Serials: location field + dual-write from `/api/serials` and stock-transactions; then stock_movements on delivery validate.
