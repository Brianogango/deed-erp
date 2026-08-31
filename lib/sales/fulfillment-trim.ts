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
  qty?: number
  qtyDelivered?: number
  qtyInvoiced?: number
  unitPrice?: number
  taxRate?: number
  discount?: number
  discountPercent?: number
  subtotal?: number
  lineTotal?: number
  serialIds?: string[]
}

function isSectionLine(line: TrimLine) {
  if (line.lineType === 'section') return true
  return Number(line.qty) === 0 && !line.productId && !(Number(line.unitPrice) > 0)
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
    const originalQty = Math.max(0, Number(line.qty) || 0)
    const floor = Math.max(
      0,
      Number(line.qtyDelivered) || 0,
      Number(line.qtyInvoiced) || 0,
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
    const money = calcSaleOrderLineMoney({ ...line, qty })
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
    unitPrice: Number(line.unitPrice) || 0,
    taxRate: Number(line.taxRate) || 0,
    discount: Number(line.discount ?? line.discountPercent) || 0,
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
    const originalQty = Math.max(0, Number(prev.qty) || 0)
    const nextQty = Math.max(0, Number(line.qty) || 0)
    const floor = Math.max(
      0,
      Number(line.qtyDelivered ?? prev.qtyDelivered) || 0,
      Number(line.qtyInvoiced ?? prev.qtyInvoiced) || 0,
    )
    if (nextQty > originalQty + 1e-9) return false
    if (nextQty + 1e-9 < floor) return false
  }

  for (const prev of current) {
    const id = lineKey(prev)
    if (id && requestedIds.has(id)) continue
    const floor = Math.max(
      0,
      Number(prev.qtyDelivered) || 0,
      Number(prev.qtyInvoiced) || 0,
    )
    // A removed line is only a trim when nothing was delivered or invoiced.
    if (floor > 0) return false
  }

  return true
}
