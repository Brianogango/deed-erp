/**
 * Purchase 3-way match: PO qty ordered → GRN qty received → vendor bill qty billed.
 */

interface ThreeWayPoLine {
  productId?: string
  qtyOrdered?: number
  qty?: number
  qtyReceived: number
  qtyBilled?: number
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

type BillMatchStatus = 'matched' | 'over_billed' | 'under_billed' | 'pending_receipt'

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

