/**
 * Purchase return allocation: decides what confirming a vendor return does to
 * the money trail, per returned unit, based on the 3-way-match state:
 *
 *  - Received but not yet billed  → wind back `qtyReceived` only (the future
 *    bill simply bills fewer units; nothing was ever owed).
 *  - Billed on a DRAFT bill       → also deduct the qty from that draft bill
 *    so it posts for the net kept quantity.
 *  - Billed on a POSTED bill      → issue a vendor credit note line, priced at
 *    the PO line's unit price and the PO line's tax rate (VAT stays zero
 *    unless the PO line itself carried VAT).
 */

import { billedQtyByPoLine } from '@/lib/purchase/receipt-allocation'

type ReturnBillDoc = {
  id: string
  type?: string
  status?: string
  total?: number
  purchaseOrderId?: string | null
  lines?: Array<{ productId?: string | null; purchaseOrderItemId?: string | null; description?: string | null; qty?: unknown }>
}

/**
 * Units on each PO line that are billed on a bill still in force. The PO's
 * stored qtyBilled goes down when a return credits units, but not when a bill
 * is cancelled, so a return after a cancelled bill treated the units as still
 * owed and issued a supplier credit for a bill nobody owed (VCN/2026/0005).
 * The live bills (not cancelled, not credit notes) give the other bound; the
 * lower of the two is what is really billed.
 */
export function liveQtyBilledByPoLine(
  po: { id: string; billId?: string | null; lines: Array<{ id: string; productId?: string | null; productName?: string | null; qty?: unknown; qtyBilled?: number }> },
  invoices: ReadonlyArray<ReturnBillDoc>,
): Map<string, number> {
  const live = invoices.filter(inv =>
    inv.type === 'vendor_bill'
    && (inv.purchaseOrderId === po.id || (po.billId && inv.id === po.billId))
    && !['cancelled', 'canceled', 'voided', 'void'].includes(String(inv.status))
    && Number(inv.total) > 0,
  )
  const fromBills = billedQtyByPoLine(po.lines, live.flatMap(b => b.lines ?? []))
  return new Map(po.lines.map(l => [l.id, Math.min(Math.max(0, Math.floor(Number(l.qtyBilled) || 0)), fromBills.get(l.id) ?? 0)]))
}

export interface ReturnPoLine {
  id: string
  productId: string
  productName: string
  qtyReceived: number
  qtyBilled?: number
  unitPrice: number
  taxRate: number
  accountCode?: string
}

interface ReturnDraftBill {
  id: string
  lines: Array<{ id: string; productId?: string; qty: number }>
}

interface ReturnLineInput {
  productId: string
  productName: string
  qty: number
}

interface PoLineAdjustment {
  poLineId: string
  qtyReceived: number
  qtyBilled: number
}

interface DraftBillDeduction {
  billId: string
  lineId: string
  deductQty: number
}

interface CreditNoteLine {
  productId: string
  productName: string
  qty: number
  unitPrice: number
  taxRate: number
  /** Positive line amount (qty × unitPrice) before sign flip on the credit note. */
  subtotal: number
  /** Per-line VAT, rounded the same way vendor bills round it. */
  taxAmount: number
  accountCode?: string
}

interface ReturnAllocation {
  poLineAdjustments: PoLineAdjustment[]
  draftBillDeductions: DraftBillDeduction[]
  creditLines: CreditNoteLine[]
  creditSubtotal: number
  creditTaxTotal: number
  creditTotal: number
}

export function allocatePurchaseReturn(args: {
  poLines: ReturnPoLine[]
  returnLines: ReturnLineInput[]
  draftBills: ReturnDraftBill[]
}): ReturnAllocation {
  // Work on mutable copies so several return lines for the same product
  // consume the remaining quantities cumulatively.
  const poState = new Map(args.poLines.map(l => [l.id, {
    received: Math.max(0, Math.floor(Number(l.qtyReceived) || 0)),
    billed: Math.max(0, Math.floor(Number(l.qtyBilled) || 0)),
  }]))
  const draftState = args.draftBills.map(b => ({
    id: b.id,
    lines: b.lines.map(l => ({ id: l.id, productId: l.productId, qty: Math.max(0, Math.floor(Number(l.qty) || 0)) })),
  }))

  const adjustments = new Map<string, PoLineAdjustment>()
  const deductions: DraftBillDeduction[] = []
  const creditLines: CreditNoteLine[] = []

  for (const ret of args.returnLines) {
    const qty = Math.max(0, Math.floor(Number(ret.qty) || 0))
    if (qty <= 0) continue
    const poLine = args.poLines.find(l => l.productId === ret.productId)
    if (!poLine) continue
    const state = poState.get(poLine.id)!

    // Never wind back more than is actually recorded as received.
    const effective = Math.min(qty, state.received)
    if (effective <= 0) continue

    const unbilled = Math.max(0, state.received - state.billed)
    const fromUnbilled = Math.min(effective, unbilled)
    let fromBilled = effective - fromUnbilled

    state.received -= effective
    state.billed -= fromBilled
    adjustments.set(poLine.id, { poLineId: poLine.id, qtyReceived: state.received, qtyBilled: state.billed })

    // Billed-but-still-draft quantities come off the draft bill, oldest first.
    for (const bill of draftState) {
      if (fromBilled <= 0) break
      for (const line of bill.lines) {
        if (fromBilled <= 0) break
        if (line.productId !== ret.productId || line.qty <= 0) continue
        const deduct = Math.min(fromBilled, line.qty)
        line.qty -= deduct
        fromBilled -= deduct
        deductions.push({ billId: bill.id, lineId: line.id, deductQty: deduct })
      }
    }

    // Whatever is left was billed on a posted bill → vendor credit note.
    if (fromBilled > 0) {
      const subtotal = fromBilled * poLine.unitPrice
      const taxAmount = Math.round(subtotal * poLine.taxRate / 100)
      creditLines.push({
        productId: poLine.productId,
        productName: ret.productName || poLine.productName,
        qty: fromBilled,
        unitPrice: poLine.unitPrice,
        taxRate: poLine.taxRate,
        subtotal,
        taxAmount,
        accountCode: poLine.accountCode,
      })
    }
  }

  const creditSubtotal = creditLines.reduce((s, l) => s + l.subtotal, 0)
  const creditTaxTotal = creditLines.reduce((s, l) => s + l.taxAmount, 0)
  return {
    poLineAdjustments: Array.from(adjustments.values()),
    draftBillDeductions: deductions,
    creditLines,
    creditSubtotal,
    creditTaxTotal,
    creditTotal: creditSubtotal + creditTaxTotal,
  }
}
