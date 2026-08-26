/**
 * Service / non-stock sale lines do not reserve warehouse qty and invoice
 * from ordered quantities (Odoo service products).
 *
 * Repair quotes often persist labour as an unlinked "Service" row with no
 * catalog productId — those must follow the same path or Confirm/Prepare/
 * Create Invoice demand a pick that can never succeed.
 */

const SERVICE_UNITS = new Set(['service', 'services', 'hour', 'hours', 'licence', 'license'])
const SERVICE_LINE_TYPES = new Set(['service', 'labor', 'labour', 'logistics', 'software'])
const REPAIR_NON_STOCK_QUOTE_TYPES = new Set(['labor', 'labour', 'service', 'logistics', 'software'])

export type NonStockLineInput = {
  lineType?: unknown
  productId?: unknown
  unit?: unknown
  invoicePolicy?: unknown
  productName?: unknown
  description?: unknown
}

export type NonStockProductInput = {
  unit?: unknown
  productKind?: unknown
  category?: unknown
  trackStock?: unknown
  trackingMethod?: unknown
  invoicePolicy?: unknown
  specs?: unknown
} | null

function specsRecord(specs: unknown): Record<string, unknown> {
  return specs && typeof specs === 'object' && !Array.isArray(specs)
    ? specs as Record<string, unknown>
    : {}
}

export function isServiceUnit(unit: unknown): boolean {
  return SERVICE_UNITS.has(String(unit ?? '').trim().toLowerCase())
}

export function isRepairNonStockQuoteType(type: unknown): boolean {
  return REPAIR_NON_STOCK_QUOTE_TYPES.has(String(type ?? '').trim().toLowerCase())
}

export function isNonStockProduct(product: NonStockProductInput | undefined): boolean {
  if (!product) return true
  const specs = specsRecord(product.specs)
  const unit = product.unit ?? specs.unit
  const kind = String(product.productKind ?? specs.productKind ?? '').toLowerCase()
  const category = String(product.category ?? specs.category ?? '').toLowerCase()
  if (product.trackStock === false) return true
  if (kind === 'service') return true
  if (isServiceUnit(unit)) return true
  if (category === 'services') return true
  const tracking = String(product.trackingMethod ?? specs.trackingMethod ?? '').toUpperCase()
  if (tracking === 'NONE') return true
  return false
}

/**
 * @param product omit when the catalog was not consulted (line hints only).
 *        Pass `null` when the catalog was searched and no product was found.
 */
export function isNonStockSaleLine(
  line: NonStockLineInput | null | undefined,
  product?: NonStockProductInput,
): boolean {
  if (!line) return true
  const lineType = String(line.lineType ?? '').trim().toLowerCase()
  if (lineType === 'section') return true
  if (SERVICE_LINE_TYPES.has(lineType)) return true
  if (isServiceUnit(line.unit)) return true
  if (String(line.invoicePolicy ?? '').toLowerCase() === 'order' && !String(line.productId ?? '').trim()) {
    return true
  }
  if (!String(line.productId ?? '').trim()) return true
  if (product === undefined) return false
  return isNonStockProduct(product)
}

export type RepairQuoteLineForSale = {
  type?: string
  productId?: string
  productName?: string
  description?: string
  qty?: number
  unitPrice?: number
  subtotal?: number
}

/** Fields stamped onto a sale-order / sales-quote line from a repair quote row. */
export function saleLineFieldsForRepairQuoteLine(line: RepairQuoteLineForSale): {
  productId: string
  productName: string
  qty: number
  unitPrice: number
  discount: number
  taxRate: number
  subtotal: number
  serialIds: string[]
  unit?: 'service'
  invoicePolicy?: 'order'
  lineType?: 'service'
} {
  const productId = String(line.productId ?? '').trim()
  const nonStock = isRepairNonStockQuoteType(line.type) || !productId
  return {
    productId,
    productName: String(line.productName ?? line.description ?? 'Item'),
    qty: Number(line.qty) || 0,
    unitPrice: Number(line.unitPrice) || 0,
    discount: 0,
    taxRate: 0,
    subtotal: Number(line.subtotal) || 0,
    serialIds: [],
    ...(nonStock ? { unit: 'service' as const, invoicePolicy: 'order' as const, lineType: 'service' as const } : {}),
  }
}
