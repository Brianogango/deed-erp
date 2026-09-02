type NamedProduct = { id: string; name: string }

type RepairLike = {
  productId?: string
  productName?: string
  serialNumber?: string
  serialId?: string
  deviceCondition?: string
  deviceBrand?: string
  deviceModel?: string
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()
const normalizeSearchText = (value: unknown) => normalize(value)
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

function uniqueMatch<T>(items: T[]): T | null {
  return items.length === 1 ? items[0] : null
}

export function findRepairCatalogProduct<T extends NamedProduct>(
  products: T[],
  repair: RepairLike,
): T | null {
  if (repair.productId) {
    const byId = products.find(p => p.id === repair.productId)
    if (byId) return byId
  }

  const name = normalizeSearchText(repair.productName)
  if (name) {
    const exact = products.find(p => normalizeSearchText(p.name) === name)
    if (exact) return exact
  }

  // Older repair intakes often stored a friendly family name (for example
  // "HP EliteBook") instead of a catalog product id. Use the structured
  // brand/model captured on the repair to recover the catalog link safely.
  const brand = normalizeSearchText(repair.deviceBrand)
  const model = normalizeSearchText(repair.deviceModel)
  if (model) {
    const byBrandModel = uniqueMatch(products.filter(product => {
      const productName = normalizeSearchText(product.name)
      return productName.includes(model) && (!brand || productName.includes(brand))
    }))
    if (byBrandModel) return byBrandModel

    // Some catalog rows omit the brand but still contain the full model.
    const byModel = uniqueMatch(products.filter(product => normalizeSearchText(product.name).includes(model)))
    if (byModel) return byModel
  }

  // As a final compatibility path, accept a family-name match only when it
  // resolves to exactly one catalog product. Never guess when several SKUs
  // share the same family name.
  if (name) {
    const byFamily = uniqueMatch(products.filter(product => {
      const productName = normalizeSearchText(product.name)
      return productName.startsWith(`${name} `) || productName.includes(` ${name} `) || name.startsWith(`${productName} `)
    }))
    if (byFamily) return byFamily
  }

  return null
}

export function buyBackConditionFromRepair(
  condition?: string,
): 'good' | 'fair' | 'poor' {
  if (condition === 'poor' || condition === 'damaged') return 'poor'
  if (condition === 'fair') return 'fair'
  return 'good'
}

export type RepairSerialMatch<T> = {
  existing: T | null
  serialText: string
}

/** Resolve serial text + existing serial row for a repair device intake. */
export function matchRepairDeviceSerial<T extends { id: string; productId: string; serial: string }>(
  serials: T[],
  productId: string,
  repair: RepairLike,
): RepairSerialMatch<T> | { error: string } {
  const serialText = String(repair.serialNumber ?? '').trim()
  if (!serialText) return { error: 'Device has no serial to intake' }
  const existing =
    serials.find(s => s.productId === productId && s.serial.toLowerCase() === serialText.toLowerCase())
    || (repair.serialId ? serials.find(s => s.id === repair.serialId) ?? null : null)
  return { existing: existing ?? null, serialText }
}

/** True when a retained repair can still be converted into stock/donation. */
export function canConvertRetainedRepair(repair: {
  status: string
  retainedBuyBackId?: string
  retainedDonationId?: string
}): boolean {
  return repair.status === 'retained' && !repair.retainedBuyBackId && !repair.retainedDonationId
}

/** Statuses where staff can open a paid trade-in from the repair job. */
export const TRADE_IN_FROM_REPAIR_STATUSES = [
  'received',
  'assigned',
  'diagnosed',
  'awaiting_approval',
  'approved',
  'awaiting_parts',
  'in_repair',
  'qc',
  'ready',
  'declined',
  'unrepairable',
  'retained',
] as const

/**
 * Paid trade-in from repair is allowed when the job is still open for that
 * path (or already declined/unrepairable/retained) and not yet linked to a
 * buy-back or donation.
 */
export function canCreateTradeInFromRepair(repair: {
  status: string
  retainedBuyBackId?: string
  retainedDonationId?: string
}): boolean {
  if (repair.retainedBuyBackId || repair.retainedDonationId) return false
  return (TRADE_IN_FROM_REPAIR_STATUSES as readonly string[]).includes(repair.status)
}
