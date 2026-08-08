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

export interface ReturnDraftBill {
  id: string
  lines: Array<{ id: string; productId?: string; qty: number }>
}

export interface ReturnLineInput {
  productId: string
  productName: string
  qty: number
}

export interface PoLineAdjustment {
  poLineId: string
  qtyReceived: number
  qtyBilled: number
}

export interface DraftBillDeduction {
  billId: string
  lineId: string
  deductQty: number
}

export interface CreditNoteLine {
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

export interface ReturnAllocation {
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
