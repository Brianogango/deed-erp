/**
 * Sales return allocation — mirrors purchase return-allocation for SOs.
 *
 * Return before invoice  → reverse delivered qty only (and draft invoice qty).
 * Return after invoice   → reverse delivered qty + credit-note lines for posted qty.
 */

export interface SalesReturnSoLine {
  id: string
  productId: string
  productName?: string
  qty: number
  qtyDelivered?: number
  qtyInvoiced?: number
  unitPrice: number
  taxRate?: number
}

export interface SalesReturnDraftInvoice {
  id: string
  lines: Array<{ id: string; productId?: string; qty: number }>
}

export interface SalesReturnLineInput {
  productId: string
  productName?: string
  qty: number
}

export interface SoLineAdjustment {
  soLineId: string
  qtyDelivered: number
  qtyInvoiced: number
}

export interface DraftInvoiceDeduction {
  invoiceId: string
  lineId: string
  deductQty: number
}

export interface SalesCreditNoteLine {
  productId: string
  productName: string
  qty: number
  unitPrice: number
  taxRate: number
  subtotal: number
  taxAmount: number
}

export interface SalesReturnAllocation {
  soLineAdjustments: SoLineAdjustment[]
  draftInvoiceDeductions: DraftInvoiceDeduction[]
  creditLines: SalesCreditNoteLine[]
  reverseDeliveredQty: number
  creditSubtotal: number
  creditTaxTotal: number
  creditTotal: number
  /** True when any posted-invoice quantity was returned (needs credit note). */
  requiresCreditNote: boolean
}

export function allocateSalesReturn(args: {
  soLines: SalesReturnSoLine[]
  returnLines: SalesReturnLineInput[]
  draftInvoices?: SalesReturnDraftInvoice[]
}): SalesReturnAllocation {
  const soState = new Map(args.soLines.map(l => [l.id, {
    delivered: Math.max(0, Math.floor(Number(l.qtyDelivered) || 0)),
    invoiced: Math.max(0, Math.floor(Number(l.qtyInvoiced) || 0)),
  }]))
  const draftState = (args.draftInvoices ?? []).map(inv => ({
    id: inv.id,
    lines: inv.lines.map(l => ({
      id: l.id,
      productId: l.productId,
      qty: Math.max(0, Math.floor(Number(l.qty) || 0)),
    })),
  }))

  const adjustments = new Map<string, SoLineAdjustment>()
  const deductions: DraftInvoiceDeduction[] = []
  const creditLines: SalesCreditNoteLine[] = []
  let reverseDeliveredQty = 0

  for (const ret of args.returnLines) {
    const qty = Math.max(0, Math.floor(Number(ret.qty) || 0))
    if (qty <= 0) continue
    const soLine = args.soLines.find(l => l.productId === ret.productId)
    if (!soLine) continue
    const state = soState.get(soLine.id)!

    const effective = Math.min(qty, state.delivered)
    if (effective <= 0) continue

    const uninvoiced = Math.max(0, state.delivered - state.invoiced)
    const fromUninvoiced = Math.min(effective, uninvoiced)
    let fromInvoiced = effective - fromUninvoiced

    state.delivered -= effective
    state.invoiced -= fromInvoiced
    reverseDeliveredQty += effective
    adjustments.set(soLine.id, {
      soLineId: soLine.id,
      qtyDelivered: state.delivered,
      qtyInvoiced: state.invoiced,
    })

    // Wind back draft invoice lines first for the invoiced slice that is still draft.
    // Remaining fromInvoiced after draft deductions becomes a credit-note quantity.
    for (const inv of draftState) {
      if (fromInvoiced <= 0) break
      for (const line of inv.lines) {
        if (fromInvoiced <= 0) break
        if (line.productId !== ret.productId || line.qty <= 0) continue
        const deduct = Math.min(fromInvoiced, line.qty)
        line.qty -= deduct
        fromInvoiced -= deduct
        deductions.push({ invoiceId: inv.id, lineId: line.id, deductQty: deduct })
      }
    }

    if (fromInvoiced > 0) {
      const unitPrice = Math.max(0, Number(soLine.unitPrice) || 0)
      const taxRate = Math.max(0, Number(soLine.taxRate) || 0)
      const subtotal = Math.round(unitPrice * fromInvoiced)
      const taxAmount = Math.round(subtotal * taxRate / 100)
      creditLines.push({
        productId: soLine.productId,
        productName: ret.productName || soLine.productName || 'Item',
        qty: fromInvoiced,
        unitPrice,
        taxRate,
        subtotal,
        taxAmount,
      })
    }
  }

  const creditSubtotal = creditLines.reduce((s, l) => s + l.subtotal, 0)
  const creditTaxTotal = creditLines.reduce((s, l) => s + l.taxAmount, 0)

  return {
    soLineAdjustments: [...adjustments.values()],
    draftInvoiceDeductions: deductions,
    creditLines,
    reverseDeliveredQty,
    creditSubtotal,
    creditTaxTotal,
    creditTotal: creditSubtotal + creditTaxTotal,
    requiresCreditNote: creditLines.length > 0,
  }
}
