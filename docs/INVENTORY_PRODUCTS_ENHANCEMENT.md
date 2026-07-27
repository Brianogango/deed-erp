# Inventory Products enhancement

## Shipped

### Phase 0 — Schema sync
- Prisma includes foundation SQL already present in production:
  - `TrackingMethod` enum + `Product.trackingMethod`
  - `SerialNumber.inventoryBarcode`
  - `InventoryBatch`, `LabelPrintJob`, `CustomerAsset`
- Permissions: `validatePurchaseReceipt`, `editSerialNumber`, `printInventoryLabels`, `viewVendorInventoryLedger`, `viewPurchaseCost`
- GRN validate store gate includes `admin_officer`

### Phase 1 — Products filters
- `InventoryProductsPanel` with Warehouse + Vendor primary filters
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
- Label settings dialog (template, size, copies, print order, include flags)
- Select-all-matching across filtered pages in `DataTable`

### Phase 4 — Vendor ledger + server GRN
- Inventory Reports → **Vendor Ledger** (`VendorInventoryLedger`)
  - Actual supplying vendor from validated receipts
  - Sales status + return status columns (customer RMA / vendor return / scrap)
  - PDF / Excel / CSV export
- Server-transactional GRN stock writes:
  - Purchase → validate receipt still owns UX validation
  - `POST /api/inventory/validate-receipt` with `apply: true` runs pure `applyReceiptValidation`
  - Multi-key batched `saveStoreKeys` (throws on persist failure)
  - Client replaces local stock state from server response; repair auto-resume stays client-side

## Known follow-ups
- Quantity vendor→sale allocation without stock layers
- Label template visually changing print HTML (settings currently drive copies/order/include for PDF path)
- Full repair auto-resume inside server apply

## Backup
- Local artifact: `backups/pre-inventory-products-enhancement-20260727T145913Z/`
- Run production `deed-erp-backup.sh` before deploy

## Rollback
- Revert this branch / FF reset master
- Restore DB from verified pre-deploy dump if schema sync was applied on server
