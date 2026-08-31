/**
 * Cancel remaining demand after a partial delivery (Odoo "No Backorder"):
 * ordered qty is reduced to delivered/invoiced, and zero-qty product lines
 * are removed so they are not invoiced later.
 */

import { calcSaleOrderLineMoney } from '@/lib/sales/line-calc'

export const FULFILLMENT_TRIM_ROLES = new Set([
  'director',
  'admin_officer',
  'inventory_officer',
  'technical_lead',
])

export function canTrimFulfillmentQty(role?: string | null): boolean {
  return !!role && FULFILLMENT_TRIM_ROLES.has(role)
}

type TrimLine = {
  id?: string
  lineType?: string
  productId?: unknown
  description?: unknown
  productName?: unknown
  qty?: unknown
  qtyDelivered?: unknown
  qtyInvoiced?: unknown
  /** Prisma Decimal or a plain number — callers coerce with asNumber(). */
  unitPrice?: unknown
  taxRate?: unknown
  discount?: unknown
  discountPercent?: unknown
  subtotal?: unknown
  lineTotal?: unknown
  serialIds?: string[]
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as { toNumber: () => unknown }).toNumber === 'function') {
    const n = Number((value as { toNumber: () => unknown }).toNumber())
    return Number.isFinite(n) ? n : 0
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function isSectionLine(line: TrimLine) {
  if (line.lineType === 'section') return true
  return asNumber(line.qty) === 0 && !line.productId && !(asNumber(line.unitPrice) > 0)
}

function dropEmptySections<T extends TrimLine>(lines: T[]): T[] {
  return lines.filter((line, index) => {
    if (!isSectionLine(line)) return true
    for (let i = index + 1; i < lines.length; i++) {
      if (isSectionLine(lines[i])) return false
      return true
    }
    return false
  })
}

function moneyEquals(a: number, b: number) {
  return Math.abs(a - b) < 0.005
}

/**
 * After qtyDelivered has been allocated for this shipment, fold ordered qty
 * down to max(delivered, invoiced). Lines at 0 are removed.
 */
export function trimSaleOrderLinesToDelivered<T extends TrimLine>(lines: readonly T[]): {
  lines: T[]
  releasedSerialIds: string[]
  changed: boolean
} {
  const next: T[] = []
  const releasedSerialIds: string[] = []
  let changed = false

  for (const line of lines) {
    if (isSectionLine(line)) {
      next.push(line)
      continue
    }
    const originalQty = Math.max(0, asNumber(line.qty))
    const floor = Math.max(
      0,
      asNumber(line.qtyDelivered),
      asNumber(line.qtyInvoiced),
    )
    const qty = Math.min(originalQty, floor)
    if (qty <= 0) {
      changed = true
      releasedSerialIds.push(...(line.serialIds ?? []))
      continue
    }
    if (qty === originalQty) {
      next.push(line)
      continue
    }
    changed = true
    const extras = (line.serialIds ?? []).slice(qty)
    releasedSerialIds.push(...extras)
    const money = calcSaleOrderLineMoney({
      lineType: line.lineType,
      qty,
      unitPrice: asNumber(line.unitPrice),
      taxRate: asNumber(line.taxRate),
      discount: asNumber(line.discount ?? line.discountPercent),
    })
    next.push({
      ...line,
      qty: money.qty,
      serialIds: (line.serialIds ?? []).slice(0, qty),
      discount: money.discountPct,
      discountPercent: money.discountPct,
      subtotal: money.lineTotal,
      lineTotal: money.lineTotal,
    })
  }

  const cleaned = dropEmptySections(next)
  if (cleaned.length !== next.length) changed = true
  return { lines: cleaned, releasedSerialIds, changed }
}

function commercialPrice(line: TrimLine) {
  return {
    unitPrice: asNumber(line.unitPrice),
    taxRate: asNumber(line.taxRate),
    discount: asNumber(line.discount ?? line.discountPercent),
  }
}

function lineKey(line: TrimLine) {
  return String(line.id || '').trim()
}

/**
 * True when the PATCH only reduces ordered qty down to already-fulfilled
 * quantities (and/or drops unfulfilled lines). Prices and taxes must not change.
 */
export function isFulfillmentQtyTrim(
  existing: { items?: TrimLine[] | null } | null | undefined,
  body: { lines?: TrimLine[] | null; items?: TrimLine[] | null; fulfillmentTrim?: unknown },
): boolean {
  if (body.fulfillmentTrim !== true && body.fulfillmentTrim !== 'true') return false
  const current = (existing?.items ?? []).filter(line => !isSectionLine(line))
  const raw = Array.isArray(body.lines) ? body.lines : body.items
  if (!Array.isArray(raw)) return false
  const requested = raw.filter(line => !isSectionLine(line))
  const requestedIds = new Set(requested.map(lineKey).filter(Boolean))

  for (const line of requested) {
    const id = lineKey(line)
    if (!id) return false
    const prev = current.find(item => lineKey(item) === id)
    if (!prev) return false
    const prevPrice = commercialPrice(prev)
    const nextPrice = commercialPrice(line)
    if (
      !moneyEquals(prevPrice.unitPrice, nextPrice.unitPrice)
      || !moneyEquals(prevPrice.taxRate, nextPrice.taxRate)
      || !moneyEquals(prevPrice.discount, nextPrice.discount)
    ) return false
    const originalQty = Math.max(0, asNumber(prev.qty))
    const nextQty = Math.max(0, asNumber(line.qty))
    const floor = Math.max(
      0,
      asNumber(line.qtyDelivered ?? prev.qtyDelivered),
      asNumber(line.qtyInvoiced ?? prev.qtyInvoiced),
    )
    if (nextQty > originalQty + 1e-9) return false
    if (nextQty + 1e-9 < floor) return false
  }

  for (const prev of current) {
    const id = lineKey(prev)
    if (id && requestedIds.has(id)) continue
    const floor = Math.max(
      0,
      asNumber(prev.qtyDelivered),
      asNumber(prev.qtyInvoiced),
    )
    // A removed line is only a trim when nothing was delivered or invoiced.
    if (floor > 0) return false
  }

  return true
}
