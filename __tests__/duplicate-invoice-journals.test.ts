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
    expect(plan.keep?.ref).toBe('JRN/INV/2026/0224/2')
    expect(plan.reverse.map(r => r.ref)).toEqual(['JRN/INV/2026/0224/5', 'JRN/INV/2026/0224/4', 'JRN/INV/2026/0224/3'])
    expect(plan.amountMismatch).toBe(false)
  })

  it('after an edit, keeps the latest posting that matches the invoice, reversing the stale one', () => {
    const [plan] = planDuplicateInvoiceJournals([{ ...inv, invoiceNumber: 'INV/2026/0194', total: 47212 }], [
      e('JRN/INV/2026/0194/2', '2026-09-04T14:18:03Z', 'u1', 40000),
      e('JRN/INV/2026/0194/3', '2026-10-04T19:35:16Z', null, 47212),
      e('JRN/INV/2026/0194/6', '2026-10-06T13:53:01Z', 'u1', 47212),
    ])
    expect(plan.keep?.ref).toBe('JRN/INV/2026/0194/6')
    expect(plan.reverse.map(r => r.ref).sort()).toEqual(['JRN/INV/2026/0194/2', 'JRN/INV/2026/0194/3'])
  })

  it('leaves invoices with one entry alone and flags a kept amount that differs', () => {
    expect(planDuplicateInvoiceJournals([inv], [e('JRN/INV/2026/0224', '2026-09-12T00:00:00Z', 'u1')])).toEqual([])
    const [plan] = planDuplicateInvoiceJournals([inv], [e('JRN/INV/2026/0224/3', '2026-10-04T19:35:05Z', null, 30000), e('JRN/INV/2026/0224/4', '2026-10-04T19:36:55Z', null, 30000)])
    expect(plan.amountMismatch).toBe(true)
  })
})

describe('only posting entries count', () => {
  it('never treats a delivery charge or payment on the invoice as a duplicate', () => {
    const plans = planDuplicateInvoiceJournals([inv], [
      e('JRN/INV/2026/0224', '2026-09-12T00:00:00Z', 'u1'),
      e('JRN/DEL/INV/2026/0224', '2026-09-12T00:01:00Z', 'u1', 500),
      e('JRN/PAY/INV/2026/0224/abc', '2026-09-13T00:00:00Z', 'u1'),
    ])
    expect(plans).toEqual([])
  })

  it('counts a bill posting (labelled bill) together with the import copies of it', () => {
    const bill = { id: 'b1', invoiceNumber: 'BILL/2026/0106', customer: 'Computer Aid', total: 1557000 }
    const be = (ref: string, at: string, by: string | null) => ({ id: ref, ref, invoiceId: 'b1', createdAt: at, createdById: by, totalDebit: 1557000 })
    const [plan] = planDuplicateInvoiceJournals([bill], [
      be('JRN/BILL/2026/0106', '2026-09-14T10:00:00Z', 'u1'),
      be('JRN/BILL/2026/0106/2', '2026-10-04T19:35:05Z', null),
      be('JRN/BILL/2026/0106/3', '2026-10-04T19:36:55Z', null),
    ])
    expect(plan.keep?.ref).toBe('JRN/BILL/2026/0106')
    expect(plan.reverse.map(r => r.ref).sort()).toEqual(['JRN/BILL/2026/0106/2', 'JRN/BILL/2026/0106/3'])
  })
})

describe('cancelled documents still booked', () => {
  it('reverses every live entry of a cancelled invoice, whatever its number became', async () => {
    const { planCancelledStillBooked } = await import('@/lib/accounting/duplicate-invoice-journals')
    const [plan] = planCancelledStillBooked(
      [{ id: 'c1', invoiceNumber: 'DRAFT/INV/AA75550F', customer: 'X', total: 36135 }],
      [{ id: 'j1', ref: 'JRN/INV/2026/0126', invoiceId: 'c1', createdAt: '2026-08-21', createdById: 'u1', totalDebit: 36135 }],
    )
    expect(plan).toMatchObject({ reason: 'cancelled', keep: null, reverse: [{ ref: 'JRN/INV/2026/0126' }] })
  })
})
