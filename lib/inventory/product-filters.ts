import { calcStockByLocation, type BulkStockLevel, type SerialNumber, type StockProduct } from '@/lib/business-logic'
import { inferTrackingMethod, isSerialTracking, type TrackingMethod } from '@/lib/inventory-identifiers'
import { inferProductKind } from '@/lib/product-kind'
import type { LocationId } from '@/lib/store'
import { matchesSearch } from '@/lib/search-utils'

export type StockAvailabilityFilter =
  | 'all'
  | 'in_stock'
  | 'out_of_stock'
  | 'low_stock'
  | 'negative'
  | 'reserved'

export type ReorderFilter =
  | 'all'
  | 'enabled'
  | 'disabled'
  | 'below_level'
  | 'required'

export type OnHandQtyFilter =
  | 'all'
  | 'gt_zero'
  | 'eq_zero'
  | 'range'

export type ProductStatusFilter = 'active' | 'archived' | 'all'

export interface ProductFilterState {
  search: string
  warehouse: LocationId | 'all'
  category: string
  vendorId: string
  productType: 'all' | 'storable' | 'consumable' | 'service' | 'stockable'
  tracking: TrackingMethod | 'all'
  reorder: ReorderFilter
  stockAvailability: StockAvailabilityFilter
  onHandQty: OnHandQtyFilter
  onHandMin: string
  onHandMax: string
  status: ProductStatusFilter
}

export const EMPTY_PRODUCT_FILTERS: ProductFilterState = {
  search: '',
  warehouse: 'all',
  category: 'All',
  vendorId: 'all',
  productType: 'all',
  tracking: 'all',
  reorder: 'all',
  stockAvailability: 'all',
  onHandQty: 'all',
  onHandMin: '',
  onHandMax: '',
  status: 'active',
}

export interface FilterableProduct {
  id: string
  name: string
  sku: string
  barcode?: string | null
  category: string
  unit?: string | null
  requiresSerial?: boolean | null
  trackingMethod?: string | null
  productKind?: string | null
  minStock: number
  stockQty: number
  isActive: boolean
  parentId?: string | null
}

export interface ProductQtySnapshot {
  onHand: number
  available: number
  /** Serials with status `assigned` (SO pick / repair part hold). */
  reserved: number
  /** Serials in refurbishment at sellable locations. */
  refurbishment: number
  /** Serials under repair at sellable locations. */
  underRepair: number
  /** onHand − available (= reserved + refurbishment + underRepair for serials). */
  held: number
  byLocation: Record<LocationId, number>
}

function inWarehouseScope(location: LocationId, warehouse: LocationId | 'all', sellable: LocationId[]) {
  if (warehouse === 'all') return sellable.includes(location)
  return location === warehouse
}

export function getProductQtySnapshot(
  product: FilterableProduct,
  serials: SerialNumber[],
  bulkStock: BulkStockLevel[],
  warehouse: LocationId | 'all',
): ProductQtySnapshot {
  const tracking = inferTrackingMethod({
    trackingMethod: product.trackingMethod,
    category: product.category,
    requiresSerial: product.requiresSerial,
    unit: product.unit,
  })
  const stockProduct: StockProduct = {
    requiresSerial: isSerialTracking(tracking) || Boolean(product.requiresSerial),
  }
  const byLocation = calcStockByLocation(stockProduct, serials, bulkStock, product.id)

  const sellableLocations: LocationId[] = ['warehouse', 'shop', 'repair_unit']
  const onHandAll = sellableLocations.reduce((sum, loc) => sum + (byLocation[loc] || 0), 0)
  const onHand = warehouse === 'all' ? onHandAll : (byLocation[warehouse] || 0)

  const productSerials = serials.filter(s => s.productId === product.id)
  const availableSerials = productSerials.filter(s =>
    (s.status === 'available' || s.status === 'in_stock') &&
    inWarehouseScope(s.location, warehouse, sellableLocations),
  )
  const reservedSerials = productSerials.filter(s =>
    s.status === 'assigned' && inWarehouseScope(s.location, warehouse, sellableLocations),
  )
  const refurbSerials = productSerials.filter(s =>
    s.status === 'refurbishment' && inWarehouseScope(s.location, warehouse, sellableLocations),
  )
  const underRepairSerials = productSerials.filter(s =>
    s.status === 'under_repair' && inWarehouseScope(s.location, warehouse, sellableLocations),
  )

  if (stockProduct.requiresSerial) {
    const available = availableSerials.length
    const reserved = reservedSerials.length
    const refurbishment = refurbSerials.length
    const underRepair = underRepairSerials.length
    return {
      onHand,
      available,
      reserved,
      refurbishment,
      underRepair,
      held: Math.max(0, onHand - available),
      byLocation,
    }
  }

  return {
    onHand,
    available: onHand,
    reserved: 0,
    refurbishment: 0,
    underRepair: 0,
    held: 0,
    byLocation,
  }
}

export function productMatchesSearch(
  product: FilterableProduct,
  search: string,
  serials: Array<{ productId: string; serial?: string; barcode?: string }>,
): boolean {
  const productSerials = serials.filter(serial => serial.productId === product.id)
  return matchesSearch(
    search,
    product.name,
    product.sku,
    product.barcode,
    product.category,
    ...productSerials.flatMap(serial => [serial.serial, serial.barcode]),
  )
}

export function productMatchesFilters(args: {
  product: FilterableProduct
  filters: ProductFilterState
  qty: ProductQtySnapshot
  serials: Array<{ productId: string; serial?: string; barcode?: string }>
  vendorProductIds?: Set<string>
}): boolean {
  const { product, filters, qty, serials, vendorProductIds } = args
  if (filters.status === 'active' && !product.isActive) return false
  if (filters.status === 'archived' && product.isActive) return false
  if (!productMatchesSearch(product, filters.search, serials)) return false
  if (filters.category !== 'All' && product.category !== filters.category) return false

  const tracking = inferTrackingMethod({
    trackingMethod: product.trackingMethod,
    category: product.category,
    requiresSerial: product.requiresSerial,
    unit: product.unit,
  })
  const kind = inferProductKind({
    productKind: product.productKind,
    trackingMethod: tracking,
    category: product.category,
    unit: product.unit,
    requiresSerial: product.requiresSerial,
  })

  if (filters.productType === 'stockable' && tracking === 'NONE') return false
  if (filters.productType === 'storable' && kind !== 'storable') return false
  if (filters.productType === 'consumable' && kind !== 'consumable') return false
  if (filters.productType === 'service' && kind !== 'service') return false
  if (filters.tracking !== 'all' && tracking !== filters.tracking) return false

  if (filters.vendorId !== 'all') {
    if (!vendorProductIds || !vendorProductIds.has(product.id)) return false
  }

  if (filters.warehouse !== 'all' && qty.onHand <= 0 && filters.stockAvailability === 'all' && filters.onHandQty === 'all') {
    // Keep products that exist in catalog even with zero at location unless stock filters imply otherwise —
    // warehouse filter alone still shows the product with warehouse-scoped qty (can be 0).
  }

  const minStock = Number(product.minStock) || 0
  const reorderEnabled = minStock > 0

  switch (filters.reorder) {
    case 'enabled':
      if (!reorderEnabled) return false
      break
    case 'disabled':
      if (reorderEnabled) return false
      break
    case 'below_level':
    case 'required':
      if (!reorderEnabled || qty.onHand >= minStock) return false
      break
    default:
      break
  }

  switch (filters.stockAvailability) {
    case 'in_stock':
      if (qty.onHand <= 0) return false
      break
    case 'out_of_stock':
      if (qty.onHand !== 0) return false
      break
    case 'low_stock':
      if (!reorderEnabled || qty.onHand <= 0 || qty.onHand >= minStock) return false
      break
    case 'negative':
      if (qty.onHand >= 0) return false
      break
    case 'reserved':
      // "Reserved stock" filter = any held (not free) units: SO pick, refurb, or repair.
      if (qty.held <= 0) return false
      break
    default:
      break
  }

  if (filters.onHandQty === 'gt_zero' && qty.onHand <= 0) return false
  if (filters.onHandQty === 'eq_zero' && qty.onHand !== 0) return false
  if (filters.onHandQty === 'range') {
    const min = filters.onHandMin === '' ? null : Number(filters.onHandMin)
    const max = filters.onHandMax === '' ? null : Number(filters.onHandMax)
    if (min !== null && !Number.isNaN(min) && qty.onHand < min) return false
    if (max !== null && !Number.isNaN(max) && qty.onHand > max) return false
  }

  return true
}

export function collectVendorProductIds(args: {
  vendorId: string
  serials: Array<{ productId: string; purchaseOrderId?: string; receiptId?: string }>
  receipts: Array<{ id: string; vendorId: string; status: string; lines: Array<{ productId: string }> }>
  purchaseOrders: Array<{ id: string; vendorId: string; lines: Array<{ productId: string }> }>
}): Set<string> {
  const ids = new Set<string>()
  if (args.vendorId === 'all') return ids

  for (const po of args.purchaseOrders) {
    if (po.vendorId !== args.vendorId) continue
    for (const line of po.lines) ids.add(line.productId)
  }
  for (const receipt of args.receipts) {
    if (receipt.vendorId !== args.vendorId) continue
    // Prefer validated supply source for stock traceability
    if (receipt.status !== 'validated') continue
    for (const line of receipt.lines) ids.add(line.productId)
  }
  for (const serial of args.serials) {
    if (!serial.purchaseOrderId && !serial.receiptId) continue
    const fromPo = args.purchaseOrders.find(po => po.id === serial.purchaseOrderId)
    if (fromPo?.vendorId === args.vendorId) ids.add(serial.productId)
    const fromReceipt = args.receipts.find(r => r.id === serial.receiptId)
    if (fromReceipt?.vendorId === args.vendorId) ids.add(serial.productId)
  }
  return ids
}

export function activeFilterChips(filters: ProductFilterState, vendorName?: string) {
  const chips: Array<{ key: string; label: string; valueLabel: string }> = []
  if (filters.warehouse !== 'all') {
    chips.push({ key: 'warehouse', label: 'Warehouse', valueLabel: filters.warehouse })
  }
  if (filters.vendorId !== 'all') {
    chips.push({ key: 'vendor', label: 'Vendor', valueLabel: vendorName || filters.vendorId })
  }
  if (filters.category !== 'All') {
    chips.push({ key: 'category', label: 'Category', valueLabel: filters.category })
  }
  if (filters.productType !== 'all') {
    const typeLabels: Record<string, string> = {
      storable: 'Storable',
      consumable: 'Consumable',
      service: 'Service',
      stockable: 'Any stock-tracked',
    }
    chips.push({
      key: 'productType',
      label: 'Type',
      valueLabel: typeLabels[filters.productType] || filters.productType,
    })
  }
  if (filters.tracking !== 'all') {
    chips.push({ key: 'tracking', label: 'Tracking', valueLabel: filters.tracking })
  }
  if (filters.reorder !== 'all') {
    chips.push({ key: 'reorder', label: 'Reorder', valueLabel: filters.reorder.replace(/_/g, ' ') })
  }
  if (filters.stockAvailability !== 'all') {
    chips.push({
      key: 'stockAvailability',
      label: 'Stock',
      valueLabel: filters.stockAvailability.replace(/_/g, ' '),
    })
  }
  if (filters.onHandQty !== 'all') {
    const range =
      filters.onHandQty === 'range'
        ? `${filters.onHandMin || '…'}–${filters.onHandMax || '…'}`
        : filters.onHandQty.replace(/_/g, ' ')
    chips.push({ key: 'onHandQty', label: 'On hand', valueLabel: range })
  }
  if (filters.status === 'archived') {
    chips.push({ key: 'status', label: 'Status', valueLabel: 'Archived' })
  } else if (filters.status === 'all') {
    chips.push({ key: 'status', label: 'Status', valueLabel: 'Active + archived' })
  }
  return chips
}
