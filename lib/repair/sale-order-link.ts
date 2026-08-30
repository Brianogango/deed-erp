/**
 * Resolve the workshop repair that a sale order was raised from.
 * Repair quotes persist as SO notes like "Repair quote — REP/0289 — …"
 * and `saleOrderId` on the repair blob.
 */

import { REPAIR_REF_IN_TEXT_RE } from '@/lib/repair-ref'

export type RepairSaleOrderLink = {
  id?: string | null
  saleOrderId?: string | null
  linkedSaleOrderId?: string | null
  saleOrderRef?: string | null
  linkedSaleOrderRef?: string | null
  ref?: string | null
  invoiceId?: string | null
}

export type SaleOrderRepairHint = {
  id?: string | null
  ref?: string | null
  orderNumber?: string | null
  quotationRef?: string | null
  notes?: string | null
}

export function extractRepairRefFromText(text?: string | null): string | undefined {
  const match = String(text ?? '').match(REPAIR_REF_IN_TEXT_RE)
  return match ? match[0].toUpperCase() : undefined
}

export function findRepairForSaleOrder<T extends RepairSaleOrderLink>(
  repairs: T[] | null | undefined,
  order: SaleOrderRepairHint | null | undefined,
): T | undefined {
  if (!order || !Array.isArray(repairs) || repairs.length === 0) return undefined
  const orderId = String(order.id ?? '').trim()
  if (orderId) {
    const byId = repairs.find(r =>
      String(r.saleOrderId ?? '') === orderId || String(r.linkedSaleOrderId ?? '') === orderId,
    )
    if (byId) return byId
  }
  const refs = [order.ref, order.orderNumber, order.quotationRef]
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
  if (refs.length) {
    const byRef = repairs.find(r =>
      refs.includes(String(r.saleOrderRef ?? '').trim())
      || refs.includes(String(r.linkedSaleOrderRef ?? '').trim()),
    )
    if (byRef) return byRef
  }
  const repairRef = extractRepairRefFromText(order.notes)
  if (!repairRef) return undefined
  return repairs.find(r => String(r.ref ?? '').toUpperCase() === repairRef)
}

export type RepairSaleOrderCandidate = SaleOrderRepairHint & {
  status?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  date?: string | null
}

const activeStatusRank = (status?: string | null) => {
  const value = String(status ?? '').toLowerCase()
  if (value === 'cancelled' || value === 'canceled') return -1
  if (['sale', 'confirmed', 'done'].includes(value)) return 3
  if (['quotation_sent', 'sent'].includes(value)) return 2
  return 1
}

const refSequence = (order: RepairSaleOrderCandidate) => {
  const ref = String(order.ref ?? order.orderNumber ?? '')
  const match = ref.match(/(\d+)(?!.*\d)/)
  return match ? Number(match[1]) : 0
}

const timestamp = (order: RepairSaleOrderCandidate) => {
  const value = order.updatedAt ?? order.createdAt ?? order.date
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : 0
}

const preferRepairSaleOrder = <T extends RepairSaleOrderCandidate>(left: T, right: T): T => {
  const statusDelta = activeStatusRank(right.status) - activeStatusRank(left.status)
  if (statusDelta !== 0) return statusDelta > 0 ? right : left
  const timeDelta = timestamp(right) - timestamp(left)
  if (timeDelta !== 0) return timeDelta > 0 ? right : left
  return refSequence(right) >= refSequence(left) ? right : left
}

/**
 * Resolve the single sale-order quotation that belongs to a repair.
 *
 * Explicit ids win. When an old repair blob has lost that link, the durable
 * "Repair quote — REP/… — …" note is used so a retry updates the existing
 * quotation instead of creating another draft.
 */
export function findSaleOrderForRepair<T extends RepairSaleOrderCandidate>(
  orders: T[] | null | undefined,
  repair: RepairSaleOrderLink | null | undefined,
): T | undefined {
  if (!repair || !Array.isArray(orders) || orders.length === 0) return undefined

  const preferredIds = [repair.saleOrderId, repair.linkedSaleOrderId]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
  for (const id of preferredIds) {
    const match = orders.find(order => String(order.id ?? '').trim() === id)
    if (match) return match
  }

  const preferredRefs = [repair.saleOrderRef, repair.linkedSaleOrderRef]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
  for (const ref of preferredRefs) {
    const match = orders.find(order =>
      [order.ref, order.orderNumber, order.quotationRef]
        .some(value => String(value ?? '').trim() === ref),
    )
    if (match) return match
  }

  const repairRef = String(repair.ref ?? '').trim().toUpperCase()
  if (!repairRef) return undefined
  const matches = orders.filter(order => extractRepairRefFromText(order.notes) === repairRef)
  return matches.reduce<T | undefined>(
    (winner, order) => winner ? preferRepairSaleOrder(winner, order) : order,
    undefined,
  )
}

/**
 * Hide historical duplicates created by the old retry path without deleting
 * financial records. The repair's explicit saleOrderId wins; otherwise the
 * most authoritative/newest quotation is shown.
 */
export function dedupeRepairSaleOrders<T extends RepairSaleOrderCandidate>(
  orders: T[] | null | undefined,
  repairs: RepairSaleOrderLink[] | null | undefined = [],
): T[] {
  if (!Array.isArray(orders) || orders.length < 2) return orders ?? []

  const groups = new Map<string, T[]>()
  orders.forEach(order => {
    const repairRef = extractRepairRefFromText(order.notes)
    if (!repairRef) return
    groups.set(repairRef, [...(groups.get(repairRef) ?? []), order])
  })

  const winners = new Map<string, T>()
  groups.forEach((group, repairRef) => {
    if (group.length < 2) return
    const linkedRepair = (repairs ?? []).find(repair =>
      String(repair.ref ?? '').toUpperCase() === repairRef,
    )
    const explicit = linkedRepair
      ? findSaleOrderForRepair(group, linkedRepair)
      : undefined
    winners.set(
      repairRef,
      explicit ?? group.reduce((winner, order) => preferRepairSaleOrder(winner, order)),
    )
  })

  return orders.filter(order => {
    const repairRef = extractRepairRefFromText(order.notes)
    const winner = repairRef ? winners.get(repairRef) : undefined
    if (!winner) return true
    if (winner.id && order.id) return winner.id === order.id
    return winner === order
  })
}

/** Back-link the workshop job to the customer invoice without changing repair status. */
export function applyInvoiceLinkToRepair<T extends Record<string, unknown>>(
  repair: T,
  invoice: { id: string; ref?: string | null; date?: string | null },
): T {
  return {
    ...repair,
    invoiceId: invoice.id,
    linkedInvoiceId: invoice.id,
    ...(invoice.date ? { invoiceDate: invoice.date } : {}),
    ...(invoice.ref ? { linkedInvoiceRef: invoice.ref } : {}),
  }
}

export function stampInvoiceOnMatchingRepair<T extends RepairSaleOrderLink & Record<string, unknown>>(
  repairs: T[],
  repair: T | undefined,
  invoice: { id: string; ref?: string | null; date?: string | null },
): T[] {
  if (!repair?.id || repair.invoiceId) return repairs
  return repairs.map(r => (r.id === repair.id ? applyInvoiceLinkToRepair(r, invoice) : r))
}

export type RepairSalesQuoteLink = {
  id?: string | null
  ref?: string | null
  salesQuoteId?: string | null
  salesQuoteRef?: string | null
}

export type SalesQuoteCandidate = {
  id?: string | null
  ref?: string | null
  quoteNumber?: string | null
  source?: string | null
  status?: string | null
  repairId?: string | null
  repairRef?: string | null
}

/** Resolve the Sales quote that was pushed from a repair quote. */
export function findSalesQuoteForRepair<T extends SalesQuoteCandidate>(
  quotes: T[] | null | undefined,
  repair: RepairSalesQuoteLink | null | undefined,
): T | undefined {
  if (!repair || !Array.isArray(quotes) || quotes.length === 0) return undefined
  const quoteId = String(repair.salesQuoteId ?? '').trim()
  if (quoteId) {
    const byId = quotes.find(quote => String(quote.id ?? '').trim() === quoteId)
    if (byId) return byId
  }
  const quoteRef = String(repair.salesQuoteRef ?? '').trim()
  if (quoteRef) {
    const byRef = quotes.find(quote =>
      String(quote.ref ?? '').trim() === quoteRef
      || String(quote.quoteNumber ?? '').trim() === quoteRef,
    )
    if (byRef) return byRef
  }
  const repairId = String(repair.id ?? '').trim()
  const repairRef = String(repair.ref ?? '').trim().toUpperCase()
  return quotes.find(quote => {
    if (String(quote.source ?? '') !== 'repair') return false
    if (repairId && String(quote.repairId ?? '').trim() === repairId) return true
    return !!repairRef && String(quote.repairRef ?? '').trim().toUpperCase() === repairRef
  })
}
