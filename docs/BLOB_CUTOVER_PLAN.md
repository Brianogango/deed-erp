# Blob → Postgres cutover (no blob SoT)

**Goal:** Every operational domain is written to Prisma/Postgres. Blobs may remain as read caches until certified and archived — never deleted without a parity certificate.

**Date started:** 2026-08-06  
**Branch:** `cursor/blob-cutover-db-sot-ddc8` (continues deliveries work)

## Sequencing

| Phase | Domain | Status |
|-------|--------|--------|
| 1 | **Deliveries** (`deed_deliveries` → `delivery_notes`) | **Done** — SO-first schema + dual-write + backfilled (41/41) |
| 2 | **Serials** (`deed_serials` → `serial_numbers`) | **In progress** — location + blob_id + dual-write |
| 3 | **Stock moves** (`deed_stockMoves` → `stock_movements`) | **In progress** — blob_id + locations + dual-write |
| 4 | **PO + GRN** (`deed_purchaseOrders`, `deed_receipts`) | **In progress** — suppliers stubs + dual-write |
| 4b | **Bulk stock** (`deed_bulkStock` → `bulk_stock_levels`) | **In progress** — location-aware qty table |
| 5 | Retire dual-write mirrors (SO/invoice/quote blobs as cache-only, then archive) | Last |

## What ships in this cutover

### Schema
- `database/migrations/20260806_blob_cutover_inventory_sot.sql`
- Serials: `location`, `blob_id`, `received_date`, `sold_date`, `product_name`
- Stock moves: `blob_id`, `from_location`, `to_location`, `document_ref`, `serial_numbers[]`
- PO/GRN: `blob_id`, vendor/destination/status fields
- New table: `bulk_stock_levels (product_id, location, qty)`

### Dual-write (hooked from `saveStoreKeys`)
- `lib/inventory/serial-mirror.ts`
- `lib/inventory/stock-move-mirror.ts`
- `lib/inventory/purchase-mirror.ts` (PO + GRN; ensures `suppliers` stubs for blob vendors)
- `lib/inventory/bulk-stock-mirror.ts`
- Deliveries mirror unchanged

### Catalog
- Inventory keys moved **BLOB_SOT → DUAL_WRITE** (`BLOB_SOT_KEYS` is empty)
- Reads still use blob until certify/archive

### Backfill
```bash
# After schema applied on Contabo:
cd /var/www/deed-erp
psql "$DATABASE_URL" -f database/migrations/20260806_blob_cutover_inventory_sot.sql
node scripts/backfill-inventory-to-prisma.mjs
# Or via API (director / internal secret):
# POST /api/admin/backfill-inventory { "force": true }
```

## Absolute rules
1. Verified backup before any production schema change  
2. Additive dual-write first; never blind-delete `deed_*`  
3. Certify via `/api/admin/blob-cutover` + `scripts/check-blob-parity.mjs`  
4. One domain soak at a time before archive  

## Still blob-read (not deleted)
UI/API still hydrates from `deed_*` blobs. Prisma is the write mirror. After parity soak, flip reads per domain then archive.
