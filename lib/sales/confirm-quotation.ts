/**
 * Confirm-quotation UX helpers.
 * Backend `confirmSO` / `prepareDelivery` remain authoritative — these only
 * gate which dialog actions the UI offers.
 */

import { calcSaleOrderLineMoney, calcSaleOrderTotals } from '@/lib/sales/line-calc'

export type ConfirmableLine = {
  id: string
  lineType?: string
  productId?: string
  productName?: string
  description?: string
  qty: number
  unitPrice?: number
  taxRate?: number
  discount?: number
  discountPercent?: number
  subtotal?: number
  lineTotal?: number
  serialIds?: string[]
  unit?: string
}

function isSectionLine(line: { lineType?: string; qty?: number; productId?: unknown; unitPrice?: number }) {
  if (line.lineType === 'section') return true
  return Number(line.qty) === 0 && !line.productId && !(Number(line.unitPrice) > 0)
}

function dropEmptySections<T extends ConfirmableLine>(lines: T[]): T[] {
  return lines.filter((line, index) => {
    if (!isSectionLine(line)) return true
    for (let i = index + 1; i < lines.length; i++) {
      if (isSectionLine(lines[i])) return false
      return true
    }
    return false
  })
}

function withLineMoney<T extends ConfirmableLine>(line: T, qty: number): T {
  const money = calcSaleOrderLineMoney({ ...line, qty })
  const serialIds = Array.isArray(line.serialIds) ? line.serialIds.slice(0, qty) : line.serialIds
  return {
    ...line,
    qty: money.qty,
    serialIds,
    discount: money.discountPct,
    discountPercent: money.discountPct,
    subtotal: money.lineTotal,
    lineTotal: money.lineTotal,
  }
}

export type ApplyConfirmLineSelectionResult<T extends ConfirmableLine> = {
  lines: T[]
  droppedIds: string[]
  releasedSerialIds: string[]
  changed: boolean
}

/**
 * Apply confirm-time qty edits: 0 (or missing override of 0) drops the line;
 * a lower qty reduces it and trims assigned serials. Quantities cannot increase.
 */
export function applyConfirmLineSelection<T extends ConfirmableLine>(
  lines: readonly T[],
  qtyByLineId?: Record<string, number> | null,
): ApplyConfirmLineSelectionResult<T> {
  if (!qtyByLineId) {
    return { lines: [...lines], droppedIds: [], releasedSerialIds: [], changed: false }
  }
  const next: T[] = []
  const droppedIds: string[] = []
  const releasedSerialIds: string[] = []
  let changed = false

  for (const line of lines) {
    if (isSectionLine(line)) {
      next.push(line)
      continue
    }
    const id = String(line.id ?? '')
    const originalQty = Math.max(0, Number(line.qty) || 0)
    const requested = Object.prototype.hasOwnProperty.call(qtyByLineId, id)
      ? Math.max(0, Math.floor(Number(qtyByLineId[id]) || 0))
      : originalQty
    const qty = Math.min(originalQty, requested)
    if (qty <= 0) {
      droppedIds.push(id)
      changed = true
      for (const serialId of line.serialIds ?? []) releasedSerialIds.push(serialId)
      continue
    }
    if (qty === originalQty) {
      next.push(line)
      continue
    }
    changed = true
    const extras = (line.serialIds ?? []).slice(qty)
    releasedSerialIds.push(...extras)
    next.push(withLineMoney(line, qty))
  }

  const cleaned = dropEmptySections(next)
  if (cleaned.length !== next.length) changed = true
  return { lines: cleaned, droppedIds, releasedSerialIds, changed }
}

export function confirmSelectionHasProduct<T extends ConfirmableLine>(lines: readonly T[]): boolean {
  return lines.some(line => !isSectionLine(line) && (Number(line.qty) || 0) > 0)
}

export function defaultConfirmQtyByLineId<T extends ConfirmableLine>(lines: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of lines) {
    if (isSectionLine(line) || !line.id) continue
    out[line.id] = Math.max(0, Number(line.qty) || 0)
  }
  return out
}

export function confirmSelectionTotals<T extends ConfirmableLine>(
  lines: readonly T[],
  headerDiscount?: number,
) {
  return calcSaleOrderTotals(lines, { headerDiscount })
}

const CONFIRM_ROLES = new Set(['director', 'sales_rep', 'admin_officer'])

/** Roles that may confirm a quotation into a sales order (matches store.confirmSO). */
export function canConfirmQuotation(role?: string | null): boolean {
  return !!role && CONFIRM_ROLES.has(role)
}

/**
 * Roles that may run prepare/reserve after confirm.
 * Mirrors `canApproveInventoryAction` in lib/store.tsx.
 */
export function canConfirmAndReserve(role?: string | null): boolean {
  return !!role && ['director', 'admin_officer', 'inventory_officer', 'technical_lead'].includes(role)
}

/**
 * "Confirm without reservation" — proposed for directors / inventory officers
 * so they can create the SO + waiting DN without allocating stock yet.
 */
export function canConfirmWithoutReservation(role?: string | null): boolean {
  return role === 'director' || role === 'inventory_officer'
}

export type ConfirmQuotationMode = 'reserve' | 'no_reserve'

export function stockShortageLines(
  lines: Array<{ lineType?: string; productId?: string; productName?: string; description?: string; qty: number; unit?: string }>,
  availableOf: (productId: string) => number,
  isNonStock?: (line: { lineType?: string; productId?: string; unit?: string }) => boolean,
): Array<{ productName: string; qty: number; available: number }> {
  const shortages: Array<{ productName: string; qty: number; available: number }> = []
  for (const line of lines) {
    if (line.lineType === 'section' || !line.productId) continue
    if (isNonStock?.(line)) continue
    const available = availableOf(line.productId)
    if (available < line.qty) {
      shortages.push({
        productName: line.productName ?? line.description ?? 'Item',
        qty: line.qty,
        available,
      })
    }
  }
  return shortages
}
