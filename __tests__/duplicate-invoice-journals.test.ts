import { describe, expect, it } from 'vitest'
import { planDuplicateInvoiceJournals } from '@/lib/accounting/duplicate-invoice-journals'

const inv = { id: 'i1', invoiceNumber: 'INV/2026/0224', customer: 'Shadock Koech', total: 35000 }
const e = (ref: string, at: string, by: string | null, amount = 35000) => ({ id: ref, ref, invoiceId: 'i1', createdAt: at, createdById: by, totalDebit: amount })

describe('invoices booked more than once', () => {
  it('keeps the entry a person posted and reverses the import copies', () => {
    const [plan] = planDuplicateInvoiceJournals([inv], [
      e('JRN/INV/2026/0224/2', '2026-10-02T13:02:35Z', 'u1'),
      e('JRN/INV/2026/0224/3', '2026-10-04T19:35:05Z', null),
      e('JRN/INV/2026/0224/4', '2026-10-04T19:36:55Z', null),
      e('JRN/INV/2026/0224/5', '2026-10-04T19:39:31Z', null),
    ])
    expect(plan.keep.ref).toBe('JRN/INV/2026/0224/2')
    expect(plan.reverse.map(r => r.ref)).toEqual(['JRN/INV/2026/0224/5', 'JRN/INV/2026/0224/4', 'JRN/INV/2026/0224/3'])
    expect(plan.amountMismatch).toBe(false)
  })

  it('after an edit, keeps the latest posting that matches the invoice, reversing the stale one', () => {
    const [plan] = planDuplicateInvoiceJournals([{ ...inv, total: 47212 }], [
      e('JRN/INV/2026/0194/2', '2026-09-04T14:18:03Z', 'u1', 40000),
      e('JRN/INV/2026/0194/3', '2026-10-04T19:35:16Z', null, 47212),
      e('JRN/INV/2026/0194/6', '2026-10-06T13:53:01Z', 'u1', 47212),
    ])
    expect(plan.keep.ref).toBe('JRN/INV/2026/0194/6')
    expect(plan.reverse.map(r => r.ref).sort()).toEqual(['JRN/INV/2026/0194/2', 'JRN/INV/2026/0194/3'])
  })

  it('leaves invoices with one entry alone and flags a kept amount that differs', () => {
    expect(planDuplicateInvoiceJournals([inv], [e('JRN/INV/2026/0224', '2026-09-12T00:00:00Z', 'u1')])).toEqual([])
    const [plan] = planDuplicateInvoiceJournals([inv], [e('A', '2026-10-04T19:35:05Z', null, 30000), e('B', '2026-10-04T19:36:55Z', null, 30000)])
    expect(plan.amountMismatch).toBe(true)
  })
})
