/**
 * What a purchase order's status means to a person. A return that sends back
 * everything received is not "partially received": the goods went back.
 */

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: 'RFQ',
  sent: 'RFQ Sent',
  confirmed: 'Purchase Order',
  partial: 'Partially Received',
  received: 'Fully Received',
  cancelled: 'Cancelled',
}

type PoLike = { id: string; status: string; lines: Array<{ qty: number; qtyReceived: number }> }
type ReturnLike = { poId: string; status: string }

export type PoStatusView = {
  /** 'returned' and 'closed_returned' are display states only. */
  key: string
  label: string
  /** Badge colour key. */
  badge: string
  /** Everything received went back to the vendor. */
  fullyReturned: boolean
}

export function poStatusView(po: PoLike, returns: ReturnLike[]): PoStatusView {
  const hasReturn = returns.some(r => r.poId === po.id && r.status === 'confirmed')
  const received = po.lines.reduce((s, l) => s + (Number(l.qtyReceived) || 0), 0)
  const fullyReturned = hasReturn && received <= 0
  if (fullyReturned && (po.status === 'confirmed' || po.status === 'partial')) {
    return { key: 'returned', label: 'Returned to vendor', badge: 'pending', fullyReturned }
  }
  if (hasReturn && po.status === 'cancelled') {
    return { key: 'closed_returned', label: 'Closed (returned)', badge: 'cancelled', fullyReturned }
  }
  if (hasReturn && po.status === 'partial') {
    return { key: 'partial', label: 'Partly returned', badge: 'partial', fullyReturned }
  }
  return { key: po.status, label: PO_STATUS_LABEL[po.status] ?? po.status, badge: po.status, fullyReturned }
}
