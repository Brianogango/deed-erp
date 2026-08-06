# Blob → Postgres cutover (no blob SoT)

**Goal:** Every operational domain is written to Prisma/Postgres. Blobs may remain as read caches until certified and archived — never deleted without a parity certificate.

**Date started:** 2026-08-06  
**Branch:** `cursor/blob-cutover-prisma-reads-ddc8`

## Sequencing

| Phase | Domain | Status |
|-------|--------|--------|
| 1 | Deliveries | **Done** — dual-write + backfill + Prisma-first reads |
| 2 | Serials | **Done** — dual-write + backfill + Prisma-first reads |
| 3 | Stock moves | **Done** |
| 4 | PO + GRN + bulk stock | **Done** |
| 5 | Certify + archive (live keys retained) | **In progress** |
| 6 | Retire live keys after soak | Later — only after write paths no longer recreate blobs |

## Prisma-first reads

- `lib/inventory/prisma-read.ts` overlays Prisma rows onto `loadAppState` / `loadInitialAppState`
- Blob rows **enrich** fields Prisma does not store yet (accessories, approval ids, etc.)
- Kill-switch: `INVENTORY_PRISMA_READ=0`
- Dual-write mirrors still upsert blobs on save (so retire is not safe yet)

## Certify + archive

```bash
# Fix orphan product parity (deleted product referenced by 1 move + 1 bulk row):
node scripts/fix-orphan-inventory-parity.mjs

# Certify + archive inventory keys (does NOT delete live keys):
node scripts/certify-archive-inventory.mjs
```

## Absolute rules
1. Verified backup before schema / retire  
2. Never blind-delete `deed_*`  
3. Certify via `/api/admin/blob-cutover` or the script above  
4. Retire only after writes stop recreating the live key  
