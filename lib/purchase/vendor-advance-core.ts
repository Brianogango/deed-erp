/**
 * Paying a supplier before the goods arrive (an advance on a purchase order).
 *
 *   Pay in advance   Dr 1934 Advances to Suppliers / Cr bank or M-Pesa
 *   Goods received   Dr 1200 Inventory / Cr 3201 GRNI            (unchanged)
 *   Bill booked      Dr 3201 GRNI (+ VAT) / Cr 3000 Payables      (unchanged)
 *   Advance applied  Dr 3000 Payables / Cr 1934 Advances          (bill shows paid)
 *   Refund           Dr bank / Cr 1934 Advances                    (never delivered)
 *
 * An advance is a payment row (type vendor_advance, no invoice) whose notes
 * start with "po:<order id>". What it has paid on bills is recorded as
 * payment allocations against it; refunds are vendor_advance_refund rows
 * whose notes start with "advance:<advance id>". Pure helpers here.
 */

export const ADVANCE_TYPE = 'vendor_advance'
export const ADVANCE_APPLIED_TYPE = 'vendor_advance_applied'
export const ADVANCE_REFUND_TYPE = 'vendor_advance_refund'

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100

export const advanceNote = (poId: string, poRef: string) => `po:${poId} · Advance for ${poRef}`
export const refundNote = (advanceId: string, poRef: string) => `advance:${advanceId} · Refund of advance on ${poRef}`

export function poIdFromAdvanceNote(notes: unknown): string | null {
  const m = /^po:([0-9a-f-]{36})/i.exec(String(notes ?? ''))
  return m ? m[1] : null
}
export function advanceIdFromRefundNote(notes: unknown): string | null {
  const m = /^advance:([0-9a-f-]{36})/i.exec(String(notes ?? ''))
  return m ? m[1] : null
}

export type AdvanceSummary = {
  id: string
  poId: string
  amount: number
  applied: number
  refunded: number
  open: number
  paidAt: string
  method: string
  reference: string | null
}

/** What an advance still has to give: paid − used on bills − refunded. */
export function advanceOpen(amount: number, applied: number, refunded: number): number {
  return Math.max(0, money(money(amount) - money(applied) - money(refunded)))
}

/** Spread what a bill still owes over open advances, oldest first. */
export function planAdvanceApplication(owed: number, advances: Array<{ id: string; open: number; paidAt: string }>): Array<{ id: string; amount: number }> {
  let left = money(owed)
  const out: Array<{ id: string; amount: number }> = []
  for (const a of [...advances].sort((x, y) => x.paidAt.localeCompare(y.paidAt))) {
    if (left <= 0) break
    const take = money(Math.min(left, a.open))
    if (take <= 0) continue
    out.push({ id: a.id, amount: take })
    left = money(left - take)
  }
  return out
}
