import { describe, expect, it } from 'vitest'
import { correctBillPaymentLines, planBillPaymentFix, type FixJournal } from '@/lib/accounting/bill-payment-fix'
import { mergeInvoiceMirror } from '@/lib/invoice-mirror-merge'
import { preservePostedInvoicePaymentProgress } from '@/lib/finance-invoice'

const receipt = (id: string, amount: number, reversed = false): FixJournal => ({
  id, ref: `JRN/PAY/BILL/2026/0007/${id}`, entryDate: '2026-09-10', isReversed: reversed,
  lines: [
    { accountLabel: '2201 - ABSA Bank', debit: amount, credit: 0 },
    { accountLabel: '1800 - Accounts Receivable', debit: 0, credit: amount },
  ],
})
const payable = (id: string, amount: number): FixJournal => ({
  id, ref: `JRN/PAY/BILL/2026/0007/${id}-b`, entryDate: '2026-09-10', isReversed: false,
  lines: [
    { accountLabel: '3000 - Accounts Payable', debit: amount, credit: 0 },
    { accountLabel: '2201 - ABSA Bank', debit: 0, credit: amount },
  ],
})
const base = { payment: { id: 'pay-1', amount: 25000, paidAt: '2026-09-10T09:00:00Z' }, bill: { id: 'bill-1', invoiceNumber: 'BILL/2026/0007', supplier: 'Tech Supplies' } }

describe('bill payments booked as customer receipts', () => {
  it('reverses the receipt and books the payment to payables, from the same bank', () => {
    const plan = planBillPaymentFix({ ...base, journals: [receipt('j1', 25000)] })!
    expect(plan).toMatchObject({ postCorrect: true, cashAccount: '2201 - ABSA Bank', amount: 25000, paidAt: '2026-09-10', reverse: [{ id: 'j1', amount: 25000 }] })
    expect(correctBillPaymentLines(plan, '3000 - Accounts Payable').map(l => [l.accountLabel, l.debit, l.credit])).toEqual([
      ['3000 - Accounts Payable', 25000, 0],
      ['2201 - ABSA Bank', 0, 25000],
    ])
  })

  it('only reverses the receipt when the correct entry is also on the ledger', () => {
    expect(planBillPaymentFix({ ...base, journals: [receipt('j1', 25000), payable('j2', 25000)] })).toMatchObject({ postCorrect: false, reverse: [{ id: 'j1' }] })
  })

  it('leaves correct, already-reversed and corrected payments alone', () => {
    expect(planBillPaymentFix({ ...base, journals: [payable('j2', 25000)] })).toBeNull()
    expect(planBillPaymentFix({ ...base, journals: [receipt('j1', 25000, true), payable('j3', 25000)] })).toBeNull()
  })
})

describe('paid documents stay paid', () => {
  it('a stale tab cannot reset a bill stored as paid / invoiced', () => {
    for (const status of ['paid', 'invoiced', 'partially_paid', 'posted']) {
      const current = [{ id: 'b1', status, amountPaid: 25000, payments: [{ id: 'p1', amount: 25000 }] }]
      const stale = [{ id: 'b1', status, amountPaid: 0, payments: [] }]
      expect((preservePostedInvoicePaymentProgress(current, stale) as any[])[0]).toMatchObject({ amountPaid: 25000, payments: [{ id: 'p1' }] })
    }
  })

  it('a draft may still be reset', () => {
    const current = [{ id: 'b1', status: 'draft', amountPaid: 0 }]
    expect((preservePostedInvoicePaymentProgress(current, [{ id: 'b1', status: 'draft', amountPaid: 0 }]) as any[])[0].amountPaid).toBe(0)
  })

  it('the table refresh keeps the payment lists and respects a reversal', () => {
    const existing = [
      { id: 'b1', amountPaid: 25000, payments: [{ id: 'p1', amount: 25000 }] },
      { id: 'i2', amountPaid: 42000, payments: [], voidedPayments: [{ id: 'p9', amount: 42000 }] },
    ]
    const table = [{ id: 'b1', amountPaid: 25000 }, { id: 'i2', amountPaid: 15000 }]
    const { merged } = mergeInvoiceMirror(table, existing) as { merged: any[] }
    expect(merged[0].payments).toEqual([{ id: 'p1', amount: 25000 }])
    expect(merged[1]).toMatchObject({ amountPaid: 15000, voidedPayments: [{ id: 'p9' }] })
  })
})
