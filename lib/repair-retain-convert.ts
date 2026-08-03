type NamedProduct = { id: string; name: string }

type RepairLike = {
  productId?: string
  productName?: string
  serialNumber?: string
  serialId?: string
  deviceCondition?: string
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

export function findRepairCatalogProduct<T extends NamedProduct>(
  products: T[],
  repair: RepairLike,
): T | null {
  if (repair.productId) {
    const byId = products.find(p => p.id === repair.productId)
    if (byId) return byId
  }
  const name = normalize(repair.productName)
  if (!name) return null
  return products.find(p => normalize(p.name) === name) ?? null
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

