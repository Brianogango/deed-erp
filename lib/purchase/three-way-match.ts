/**
 * Purchase 3-way match: PO qty ordered → GRN qty received → vendor bill qty billed.
 */

export interface ThreeWayPoLine {
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

export type BillMatchStatus = 'matched' | 'over_billed' | 'under_billed' | 'pending_receipt'

export function billMatchStatus(line: ThreeWayPoLine): BillMatchStatus {
  const ordered = Math.max(0, Math.floor(Number(poLine.qtyOrdered ?? poLine.qty) || 0))
  const received = Math.max(0, Math.floor(Number(poLine.qtyReceived) || 0))
  const billed = Math.max(0, Math.floor(Number(poLine.qtyBilled) || 0))

  if (received === 0 && billed === 0) return 'pending_receipt'
  if (billed > received) return 'over_billed'
  if (received < ordered && billed < received) return 'under_billed'
  if (billed === received && received > 0) return 'matched'
  if (billed < received) return 'under_billed'
  return 'matched'
}
