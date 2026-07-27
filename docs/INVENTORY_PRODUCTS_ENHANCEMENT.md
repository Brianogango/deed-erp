# Inventory Products enhancement

## Shipped in this branch (Phases 0–3 foundation)

### Phase 0 — Schema sync
- Prisma now includes foundation SQL already present in production:
  - `TrackingMethod` enum + `Product.trackingMethod`
  - `SerialNumber.inventoryBarcode`
  - `InventoryBatch`, `LabelPrintJob`, `CustomerAsset`
- Permissions added: `validatePurchaseReceipt`, `editSerialNumber`, `printInventoryLabels`, `viewVendorInventoryLedger`, `viewPurchaseCost`
- GRN validate store gate includes `admin_officer`

### Phase 1 — Products filters
- New `InventoryProductsPanel` with Warehouse + Vendor primary filters
- More filters: category, type, tracking, reorder, stock availability, on-hand range, archived
- Warehouse-scoped On hand / Available / Reserved
- Active filter chips

### Phase 2 — Serials
- Product row **Serials: N** opens serial drawer
- Edit serial (permission-gated) with reason + duplicate checks
- API `/api/serials/[id]` validates + writes audit log

### Phase 3 — Bulk labels
- Row selection + bulk Print / Download PDF
- PDF via jsPDF (`lib/inventory/label-pdf.ts`)
- Client audit via `addAuditLog`

## Not yet in this PR (follow-up)
- Full vendor inventory ledger report + exports
- Return-status columns in ledger
- Server-transactional GRN validate (stock writes still client `validateReceipt`)
- Select-all-matching-across-pages
- Label settings dialog / templates

## Backup
- Local artifact: `backups/pre-inventory-products-enhancement-20260727T145913Z/`
- Run production `deed-erp-backup.sh` before deploy

## Rollback
- Revert this branch / FF reset master
- Restore DB from verified pre-deploy dump if schema sync was applied on server
