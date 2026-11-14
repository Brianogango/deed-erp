import type { CategoryId } from '@/lib/product-categories'
import type { TrackingMethod } from '@/lib/inventory-identifiers'
import type { LocationId } from './core'

export type Product = {
  id: string; name: string; sku: string; barcode: string
  category: CategoryId; salePrice: number; costPrice: number; taxRate: number
  /** Unit cost on the most recent goods receipt — pricing and replacement value only (costPrice is the average the books use). */
  latestCost?: number
  latestCostDate?: string
  latestCostRef?: string
  /** Optional channel prices — used by WHOLESALE / KILIMALL pricelists. */
  wholesalePrice?: number
  kilimallPrice?: number
  /** Product override for sales commission %. Empty → category rate, else 0. */
  commissionRatePercent?: number
  /** Odoo-style commercial type: storable | consumable | service */
  productKind?: import('@/lib/product-kind').ProductKind
  trackingMethod?: TrackingMethod
  // stockQty is derived from serials+moves — kept for display/quick access
  stockQty: number; minStock: number; unit: string
  // Odoo-style invoicing policy: invoice Ordered ('order') or Delivered
  // ('delivery') quantities. Default is 'order'.
  invoicePolicy?: 'order' | 'delivery'
  description: string; canBeSold: boolean; canBePurchased: boolean
  image: string; isActive: boolean; warrantyMonths: number
  requiresSerial: boolean  // maintained for backward compatibility with legacy flows
  saleAccountCode?: string  // revenue account code e.g. '5001'
  costAccountCode?: string  // cost/purchase account code e.g. '6101'
  inventoryAccountCode?: string  // inventory asset account code e.g. '1200'
  cogsAccountCode?: string       // cost of goods sold account code e.g. '6001'
  adjustmentAccountCode?: string // stock gain/variance account code
  writeOffAccountCode?: string   // damage, theft, expiry, and write-off expense account code
  priceDifferenceAccountCode?: string // PO vs vendor bill price variance
  parentId?: string          // links to a parent product — makes this a variant
  /** Optional override into pricingMarginPolicy.categories (e.g. brand_new_pcs, monitors). */
  pricingCategoryId?: string
  /** new | refurbished — drives Brand New PCs vs refurb margin bands for Laptops/Desktops. */
  productType?: 'new' | 'refurbished'
  /**
   * Default RAM/SSD for this SKU, parsed from the name on save.
   * Per-serial live config lives on serial.specs after intake or reconfig.
   */
  deviceConfig?: {
    totalRamGb: number
    primaryStorageGb?: number | null
    storageType?: string | null
    processor?: string | null
    processorGeneration?: string | null
  } | null
  priceUpdatedAt?: string
  priceUpdatedBy?: string
  /** False for services and other lines that never touch stock. */
  trackStock?: boolean
}

export interface ProductPriceHistory {
  id: string
  productId: string
  productName: string
  sku: string
  oldSalePrice: number
  newSalePrice: number
  oldCostPrice: number
  newCostPrice: number
  reason: string
  effectiveDate: string
  updatedById?: string
  updatedByName: string
  updatedAt: string
}

// Individual serialized unit
export interface SerialNumber {
  id: string; serial: string; productId: string; productName: string
  sku?: string
  location: LocationId
  status: 'available' | 'assigned' | 'sold' | 'under_repair' | 'returned' | 'written_off' | 'refurbishment' | 'reconfiguration' | 'capitalised'
  purchaseOrderId?: string; receiptId?: string
  saleOrderId?: string; warrantyId?: string; repairId?: string
  receivedDate: string; soldDate?: string
  barcode: string  // same as serial or system-generated
  accessories?: string[]   // accessories received with unit e.g. ['Charger', 'Bag']
  accessoryNotes?: string  // free-text note about condition / missing items
  specs?: string           // freetext specs e.g. "8GB RAM, 512GB SSD, Intel i5-12th Gen"
  /** Unit selling price after reconfiguration; POS uses this over catalog list price. */
  salePriceOverride?: number
  /** Customer machine registered on a screen (buyback, exchange, donation-in, rma …) and by whom. */
  intakeSource?: string
  intakeByName?: string
  /** Came in without a readable serial: `serial` is the intake tag (UNK-…) until identified. */
  identityPending?: boolean
  /** The sticker tag it came in with; kept after the real serial is found. */
  intakeTag?: string
  /** What this unit cost to take in (trade-in price, or its share of the stock it came from). */
  intakeCost?: number
  identifiedDate?: string
  /** It was sold by us before and came back; the order it went out on. */
  previousSaleOrderId?: string
}

// Refurbishment job — unit received with issues, needs work before going to sales floor
export type RefurbStatus = 'queued' | 'assigned' | 'in_progress' | 'ready' | 'transferred' | 'written_off'

export interface RefurbPart {
  id: string
  partName: string
  productId?: string        // linked inventory product (optional — parts may not be in catalogue)
  qty: number
  estimatedCost: number
  // 'needed'    — logged but not yet actioned
  // 'requested' — tech asked for it; lead tech alerted (stock was unavailable)
  // 'allocated' — lead tech pulled it from stock
  // 'ordered'   — PO raised for it
  // 'received'  — PO received / part is now in-house
  // 'used'      — installed in the device
  status: 'needed' | 'requested' | 'allocated' | 'ordered' | 'received' | 'used'
  requestedDate?: string
  allocatedDate?: string
  allocatedByName?: string
  notifiedTechDate?: string   // when lead tech flagged it ready for the tech
  poId?: string               // linked purchase order (if ordered)
  poRef?: string
  orderedDate?: string
  receivedDate?: string
  requestedByName?: string
  /** Parts queue: count corrections raised for it, and products whose count was checked. */
  adjustmentRefs?: string[]
  countCheckedProductIds?: string[]
  notes?: string
  /** How this RAM/SSD was fitted. Battery/keyboard leave this unset. */
  installAction?: 'add' | 'swap'
  /** The part was taken out of warehouse stock for this job (older rows: allocatedDate is set). */
  stockTaken?: boolean
}

export interface RefurbishmentJob {
  id: string
  ref: string           // e.g. REF/0001
  status: RefurbStatus
  serialId: string
  serialNumber: string
  productId: string
  productName: string
  specs?: string
  /** Frozen unit specs at intake so RAM/SSD parts can be reapplied without stacking. */
  specsAtIntake?: string
  receiptId?: string
  receiptRef?: string
  intakeDate: string
  intakeIssueDescription: string   // issue flagged on receipt
  assignedTechnicianId?: string
  assignedTechnicianName?: string
  assignedDate?: string
  /** When the technician pressed Start. */
  startedDate?: string
  /** What the assigned technician found wrong (the diagnosis). Intake no longer asks for it. */
  issuesFound?: string
  techNotes?: string   // technician's running notes / diagnosis
  partsNeeded: RefurbPart[]
  completedDate?: string
  transferDate?: string
  underWarranty?: boolean
  /** Cost taken off the books when written off (reversed exactly on restore). Unset: written off before this was booked. */
  writeOffCost?: number
  writeOffValuationRef?: string
  /** No readable serial at intake; Ready and retest wait for identification. */
  identityPending?: boolean
  intakeTag?: string
  intakeCost?: number
  intakeSource?: 'trade_in' | 'stock' | 'unrecorded' | 'receipt'
  intakeSourceRef?: string
  identifiedDate?: string
  /** Not repairable and stripped: the parts kept went to stock. */
  outcome?: 'harvested'
  harvestedParts?: Array<{ productId: string; productName: string; qty: number; unitValue: number }>
  /** Cost the harvested parts carried into stock (the rest is in writeOffCost). */
  harvestPartsValue?: number
}

export type TaggedIntakeInput = {
  productId: string
  units: Array<{ cost?: number | null; note?: string; issue: string; serial?: string; assetId?: string; productId?: string }>
  /** Taken from quantity stock of another product; omit for machines never on record. */
  from?: { productId: string; location: LocationId }
  reference?: string
  /** With Issues first (sent to Refurbishment later), or straight to the bench (default). */
  destination?: 'with_issues' | 'refurbishment'
}

// ── Outbound Release Checkpoint ───────────────────────────────────────────────
export type ReleaseStatus = 'pending' | 'all_picked' | 'verified' | 'released' | 'voided'

export type ItemReleaseStatus = 'picked' | 'verified' | 'released'

export type SignatureMethod = 'digital' | 'paper'

export interface OrcItem {
  id: string
  releaseId: string
  serialNumberId: string
  expectedSerial: string
  confirmedSerial?: string
  serialMatched?: boolean
  status: ItemReleaseStatus
  verifiedById?: string
  verifiedAt?: string
}

export interface OrcLogEntry {
  id: string
  releaseId: string
  action: string
  fromStatus?: string
  toStatus?: string
  performedById: string
  performedByName?: string
  performedAt: string
  notes?: string
  metadata?: Record<string, unknown>
}

export interface OutboundRelease {
  id: string
  ref: string
  // source — exactly one set
  invoiceId?: string
  repairId?: string
  deliveryNoteId?: string
  // source doc display info (populated client-side for quick display)
  sourceRef?: string
  sourceType?: 'invoice' | 'repair' | 'delivery_note'
  clientId: string
  clientName?: string
  status: ReleaseStatus
  initiatedById: string
  initiatedByName?: string
  initiatedAt: string
  verifiedById?: string
  verifiedByName?: string
  verifiedAt?: string
  receivedBy?: string
  receivedByPhone?: string
  releaseNotes?: string
  conditionOnRelease?: string
  // signatures
  receiverSigData?: string
  receiverSigMethod?: SignatureMethod
  receiverSigRef?: string
  releaserSigData?: string
  releaserSigMethod?: SignatureMethod
  releaserSigRef?: string
  customerAckSigData?: string
  customerAckSigMethod?: SignatureMethod
  customerAckSigRef?: string
  releasedAt?: string
  voidedById?: string
  voidReason?: string
  voidedAt?: string
  items: OrcItem[]
  auditLog: OrcLogEntry[]
  createdAt: string
  updatedAt: string
}

/** Device loan / temporary issue log (Holdovers module). */
export type HoldoverStatus = 'active' | 'returned' | 'overdue'

export type HoldoverPurpose = 'repair_loaner' | 'exam' | 'purchase_pending' | 'short_term' | 'other'

export type HoldoverDeviceCondition = 'excellent' | 'good' | 'fair' | 'damaged'

export interface Holdover {
  id: string
  ref: string
  clientName: string
  clientPhone: string
  clientIdNo: string
  productId: string
  productName: string
  serialId: string
  serialNumber: string
  deviceCondition: HoldoverDeviceCondition
  accessories: string
  purpose: HoldoverPurpose
  purposeNote: string
  linkedRepairId: string
  linkedRepairRef: string
  issuedDate: string
  expectedReturnDate: string
  returnedDate: string
  returnCondition: HoldoverDeviceCondition | ''
  returnNotes: string
  returnLocation: 'shop' | 'warehouse'
  status: HoldoverStatus
  issuedByName: string
  authorizedByUserId: string
  authorizedByName: string
  extensionHistory?: Array<{
    previousDate: string
    newDate: string
    note?: string
    extendedAt: string
    extendedByName: string
  }>
  createdAt: string
}

export interface StockMove {
  id: string; type: 'in' | 'out' | 'transfer' | 'adjustment' | 'return'
  productId: string; productName: string; qty: number; reason: string
  fromLocation?: LocationId; toLocation?: LocationId
  serialNumbers: string[]; date: string; userId: string
  documentRef: string  // PO ref, SO ref, etc.
}

export interface BulkStockLevel {
  productId: string
  location: LocationId
  qty: number
}

export type AdjReason = 'damage' | 'theft' | 'count_correction' | 'expiry' | 'other'

export type AdjStatus = 'pending' | 'approved' | 'rejected'

export interface StockAdjustment {
  id: string; ref: string
  productId: string; productName: string
  type: 'add' | 'subtract'
  qty: number; reason: AdjReason; notes: string
  status: AdjStatus
  inventoryAccountCode?: string
  varianceAccountCode?: string
  writeOffAccountCode?: string
  requestedBy: string; approvedBy?: string
  date: string; approvedDate?: string
  /** The number it had before renumbering (it repeated another's); its journals and moves carry it. */
  formerRef?: string
}
