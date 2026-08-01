/**
 * Pure planners for repair part reservation / consumption stock moves.
 * Store applies the plans against live serials + bulkStock.
 */

export type LocationId = 'warehouse' | 'shop' | 'repair_unit' | 'vendor' | 'customer' | 'employee'

export type RepairPartLine = {
  productId: string
  productName: string
  qty: number
  requiresSerial: boolean
}

export type StockSnapshot = {
  warehouse: number
  shop: number
  repair_unit: number
}

export type ReservePlanStep =
  | {
      kind: 'transfer_bulk'
      productId: string
      productName: string
      qty: number
      from: LocationId
      to: 'repair_unit'
      reason: string
    }
  | {
      kind: 'assign_serial'
      productId: string
      productName: string
      serialId: string
      serialNumber: string
      from: LocationId
      reason: string
    }

export type ConsumePlanStep =
  | {
      kind: 'consume_bulk'
      productId: string
      productName: string
      qty: number
      from: LocationId
      reason: string
    }
  | {
      kind: 'consume_serial'
      productId: string
      productName: string
      serialId: string
      serialNumber: string
      from: LocationId
      reason: string
    }

/** Prefer shop, then warehouse, for pulling parts into repair_unit. */
export function pickSourceLocation(stock: StockSnapshot, qty: number): LocationId | null {
  if (stock.shop >= qty) return 'shop'
  if (stock.warehouse >= qty) return 'warehouse'
  if (stock.shop + stock.warehouse >= qty) {
    // Caller should split — return shop first for partial; planner splits below.
    return stock.shop > 0 ? 'shop' : 'warehouse'
  }
  if (stock.repair_unit >= qty) return 'repair_unit'
  return null
}

/**
 * Plan transfers into repair_unit for bulk parts, and serial assignments.
 * Serials are only planned by id list supplied by the caller (already filtered available).
 */
export function planRepairPartReserve(params: {
  repairRef: string
  lines: RepairPartLine[]
  stockFor: (productId: string) => StockSnapshot
  availableSerialsFor: (productId: string) => Array<{ id: string; serial: string; location: LocationId }>
}): { steps: ReservePlanStep[]; errors: string[] } {
  const steps: ReservePlanStep[] = []
  const errors: string[] = []
  const reason = `Parts reserved — repair ${params.repairRef}`

  for (const line of params.lines) {
    if (!line.productId || line.qty <= 0) continue

    if (line.requiresSerial) {
      const serials = params.availableSerialsFor(line.productId).slice(0, line.qty)
      if (serials.length < line.qty) {
        errors.push(`Insufficient serial stock for ${line.productName}`)
        continue
      }
      for (const s of serials) {
        steps.push({
          kind: 'assign_serial',
          productId: line.productId,
          productName: line.productName,
          serialId: s.id,
          serialNumber: s.serial,
          from: s.location,
          reason,
        })
      }
      continue
    }

    let remaining = line.qty
    const stock = params.stockFor(line.productId)
    // Prefer moving from shop/warehouse into repair_unit (not consuming yet).
    for (const loc of ['shop', 'warehouse'] as const) {
      if (remaining <= 0) break
      const available = stock[loc]
      if (available <= 0) continue
      const take = Math.min(remaining, available)
      steps.push({
        kind: 'transfer_bulk',
        productId: line.productId,
        productName: line.productName,
        qty: take,
        from: loc,
        to: 'repair_unit',
        reason,
      })
      remaining -= take
    }
    // Already sitting in repair_unit counts as reserved — no move needed.
    if (remaining > 0 && stock.repair_unit >= remaining) {
      remaining = 0
    }
    if (remaining > 0) {
      errors.push(`Insufficient stock for ${line.productName}`)
    }
  }

  return { steps, errors }
}

/**
 * Plan consumption from repair_unit first, then shop/warehouse fallback.
 */
export function planRepairPartConsume(params: {
  repairRef: string
  lines: RepairPartLine[]
  stockFor: (productId: string) => StockSnapshot
  assignedSerialsFor: (productId: string) => Array<{ id: string; serial: string; location: LocationId }>
}): { steps: ConsumePlanStep[]; errors: string[] } {
  const steps: ConsumePlanStep[] = []
  const errors: string[] = []
  const reason = `Repair ${params.repairRef}`
  const stockCache = new Map<string, StockSnapshot>()
  const usedSerialIds = new Set<string>()

  for (const line of params.lines) {
    if (!line.productId || line.qty <= 0) continue

    if (line.requiresSerial) {
      const serials = params.assignedSerialsFor(line.productId)
        .filter(s => !usedSerialIds.has(s.id))
        .slice(0, line.qty)
      if (serials.length < line.qty) {
        errors.push(`Missing assigned serials for ${line.productName}`)
        continue
      }
      for (const s of serials) {
        usedSerialIds.add(s.id)
        steps.push({
          kind: 'consume_serial',
          productId: line.productId,
          productName: line.productName,
          serialId: s.id,
          serialNumber: s.serial,
          from: 'repair_unit',
          reason,
        })
      }
      continue
    }

    let remaining = line.qty
    let stock = stockCache.get(line.productId)
    if (!stock) {
      stock = { ...params.stockFor(line.productId) }
      stockCache.set(line.productId, stock)
    }
    for (const loc of ['repair_unit', 'shop', 'warehouse'] as const) {
      if (remaining <= 0) break
      const available = stock[loc]
      if (available <= 0) continue
      const take = Math.min(remaining, available)
      steps.push({
        kind: 'consume_bulk',
        productId: line.productId,
        productName: line.productName,
        qty: take,
        from: loc,
        reason,
      })
      stock[loc] -= take
      remaining -= take
    }
    if (remaining > 0) {
      errors.push(`Insufficient stock to consume ${line.productName}`)
    }
  }

  return { steps, errors }
}
