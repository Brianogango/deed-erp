/**
 * Purchase 3-way match: PO qty ordered → GRN qty received → vendor bill qty billed.
 */

export interface ThreeWayPoLine {
  productId?: string
  qtyOrdered?: number
  qty?: number
  qtyReceived: number
  qtyBilled?: number
}

export interface VendorBillLineForMatch {
  productId?: string
  qty?: number
  description?: string
}

export function billableQty(poLine: ThreeWayPoLine): number {
  const received = Math.max(0, Math.floor(Number(poLine.qtyReceived) || 0))
  const billed = Math.max(0, Math.floor(Number(poLine.qtyBilled) || 0))
  return Math.max(0, received - billed)
}

/**
 * True when any PO line already has received stock.
 * Create Bill should follow qtyReceived (Prisma GRN / hydrate), not a blob
 * receipt with status === 'validated' — valuation failures can leave the
 * GRN unvalidated in the blob while the PO line still shows received qty.
 */
export function poHasReceivedGoods(poLines: ThreeWayPoLine[]): boolean {
  return poLines.some(l => Math.max(0, Math.floor(Number(l.qtyReceived) || 0)) > 0)
}

/** Throws when qtyToBill would exceed received − already billed. */
export function assertBillableQty(poLine: ThreeWayPoLine, qtyToBill: number): void {
  const qty = Math.max(0, Math.floor(Number(qtyToBill) || 0))
  if (qty <= 0) return
  const received = Math.max(0, Math.floor(Number(poLine.qtyReceived) || 0))
  const billed = Math.max(0, Math.floor(Number(poLine.qtyBilled) || 0))
  const remaining = received - billed
  if (qty > remaining) {
    throw new Error(
      `Cannot bill ${qty} units: only ${remaining} received and unbilled (received ${received}, billed ${billed})`,
    )
  }
}

/**
 * Assert each bill line against PO lines matched by productId.
 * Lines without productId are skipped (section / free-text).
 * Aggregates qty by productId on the bill before comparing.
 */
export function assertVendorBillThreeWayMatch(params: {
  poLines: ThreeWayPoLine[]
  billLines: VendorBillLineForMatch[]
}): void {
  const billQtyByProduct = new Map<string, number>()
  for (const line of params.billLines) {
    const productId = String(line.productId || '').trim()
    if (!productId) continue
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue
    billQtyByProduct.set(productId, (billQtyByProduct.get(productId) || 0) + qty)
  }

  for (const [productId, qtyToBill] of billQtyByProduct) {
    const poLine = params.poLines.find(l => String(l.productId || '') === productId)
    if (!poLine) {
      throw new Error(`Cannot bill product ${productId}: not found on purchase order`)
    }
    try {
      assertBillableQty(poLine, qtyToBill)
    } catch (err: any) {
      const msg = String(err?.message || err)
      throw new Error(`3-way match failed for product ${productId}: ${msg}`)
    }
  }
}

export type BillMatchStatus = 'matched' | 'over_billed' | 'under_billed' | 'pending_receipt'

export function billMatchStatus(line: ThreeWayPoLine): BillMatchStatus {
  const ordered = Math.max(0, Math.floor(Number(line.qtyOrdered ?? line.qty) || 0))
  const received = Math.max(0, Math.floor(Number(line.qtyReceived) || 0))
  const billed = Math.max(0, Math.floor(Number(line.qtyBilled) || 0))

  if (received === 0 && billed === 0) return 'pending_receipt'
  if (billed > received) return 'over_billed'
  if (received < ordered && billed < received) return 'under_billed'
  if (billed === received && received > 0) return 'matched'
  if (billed < received) return 'under_billed'
  return 'matched'
}

/** Aggregate match status across PO lines for reporting. */
export function summarizePoThreeWayMatch(poLines: ThreeWayPoLine[]): {
  status: BillMatchStatus | 'empty'
  lines: Array<ThreeWayPoLine & { match: BillMatchStatus; billable: number }>
} {
  if (!poLines.length) return { status: 'empty', lines: [] }
  const lines = poLines.map(l => ({
    ...l,
    match: billMatchStatus(l),
    billable: billableQty(l),
  }))
  if (lines.some(l => l.match === 'over_billed')) return { status: 'over_billed', lines }
  if (lines.every(l => l.match === 'matched' || (l.billable === 0 && (l.qtyReceived || 0) > 0))) {
    const anyPending = lines.some(l => l.match === 'pending_receipt')
    if (anyPending && lines.every(l => l.match === 'pending_receipt' || l.match === 'matched')) {
      return { status: lines.every(l => l.match === 'pending_receipt') ? 'pending_receipt' : 'matched', lines }
    }
  }
  if (lines.some(l => l.match === 'pending_receipt') && lines.every(l => l.match === 'pending_receipt')) {
    return { status: 'pending_receipt', lines }
  }
  if (lines.some(l => l.match === 'under_billed')) return { status: 'under_billed', lines }
  if (lines.every(l => l.match === 'matched')) return { status: 'matched', lines }
  return { status: 'under_billed', lines }
}
