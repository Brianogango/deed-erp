/**
 * A supplier credit note (VCN) is stored as a vendor bill with a negative
 * total. What has been used of it is a negative amount paid, and each bill it
 * was used on carries a "vendor_credit" payment whose reference is the
 * credit note's number.
 */

type Doc = {
  id: string
  ref: string
  type: string
  total: number
  amountPaid: number
  notes?: string
  payments?: ReadonlyArray<{ amount: number; method?: string; reference?: string; supplierRefund?: boolean }>
}

export type VendorCreditUse = { billId: string | null; billRef: string; amount: number }

export type VendorCreditSummary = {
  /** Size of the credit, as a positive number. */
  amount: number
  /** How much of it has been used against bills (or refunded). */
  applied: number
  /** What the supplier still owes us. */
  remaining: number
  usedOn: VendorCreditUse[]
  /** Paid back by the supplier. */
  refunded: number
}

const round = (n: number) => Math.round(n * 100) / 100

export function isVendorCreditNote(doc: Pick<Doc, 'type' | 'total' | 'ref'>): boolean {
  return (doc.type === 'vendor_bill' || /^VCN\b/i.test(doc.ref ?? '')) && Number(doc.total) < 0
}

export function vendorCreditSummary(credit: Doc, bills: ReadonlyArray<Doc>): VendorCreditSummary {
  const amount = round(Math.abs(Number(credit.total) || 0))
  const applied = round(Math.min(amount, Math.abs(Number(credit.amountPaid) || 0)))
  const usedOn: VendorCreditUse[] = []
  for (const bill of bills) {
    if (bill.id === credit.id) continue
    const sum = (bill.payments ?? [])
      .filter(p => p.method === 'vendor_credit' && p.reference === credit.ref)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    if (sum > 0) usedOn.push({ billId: bill.id, billRef: bill.ref, amount: round(sum) })
  }
  // Older credit notes only name the bills in their notes ("Applied to BILL/…").
  if (!usedOn.length && applied > 0) {
    const m = /Applied to ([^\n]+)/i.exec(credit.notes ?? '')
    const refs = m ? m[1].split(',').map(r => r.trim()).filter(Boolean) : []
    for (const ref of refs) {
      const bill = bills.find(b => b.ref === ref)
      usedOn.push({ billId: bill?.id ?? null, billRef: ref, amount: refs.length === 1 ? applied : 0 })
    }
  }
  const refunded = round((credit.payments ?? [])
    .filter(p => p.supplierRefund)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0))
  return { amount, applied, remaining: round(Math.max(0, amount - applied)), usedOn, refunded }
}

/** What is left of a supplier credit (stored row: negative total, amountPaid ≤ 0). */
export function creditOpenAmount(credit: { totalAmount: unknown; amountPaid: unknown }): number {
  return Math.round((Math.abs(Number(credit.totalAmount)) - Math.abs(Number(credit.amountPaid))) * 100) / 100
}
