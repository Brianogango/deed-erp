import { describe, it, expect } from 'vitest'
import { findRepairLinkedInvoice } from '@/lib/portal-invoice-link'

describe('findRepairLinkedInvoice', () => {
  const invoices = [
    { id: 'sale-inv', ref: 'INV/2026/0044', total: 51700 },
    { id: 'repair-inv', ref: 'INV/2026/0099', total: 4000, invoiceNumber: 'INV/2026/0099' },
    { id: 'legacy', invoiceNumber: 'INV-00073', total: 5500 },
  ]

  it('does not bind unlinked repairs to the first invoice missing invoiceNumber (REP-277762 bug)', () => {
    expect(findRepairLinkedInvoice(invoices, {
      invoiceId: undefined,
      linkedInvoiceId: undefined,
      linkedInvoiceRef: undefined,
    })).toBeUndefined()

    expect(findRepairLinkedInvoice(invoices, {
      invoiceId: null,
      linkedInvoiceId: null,
      linkedInvoiceRef: null,
    })).toBeUndefined()

    expect(findRepairLinkedInvoice(invoices, {})).toBeUndefined()
  })

  it('matches by invoice id', () => {
    expect(findRepairLinkedInvoice(invoices, { invoiceId: 'repair-inv' })?.total).toBe(4000)
  })

  it('matches by linkedInvoiceId when invoiceId is absent', () => {
    expect(findRepairLinkedInvoice(invoices, { linkedInvoiceId: 'repair-inv' })?.ref).toBe('INV/2026/0099')
  })

  it('matches by linkedInvoiceRef against ref or invoiceNumber', () => {
    expect(findRepairLinkedInvoice(invoices, { linkedInvoiceRef: 'INV/2026/0044' })?.id).toBe('sale-inv')
    expect(findRepairLinkedInvoice(invoices, { linkedInvoiceRef: 'INV-00073' })?.id).toBe('legacy')
  })

  it('ignores blank link fields', () => {
    expect(findRepairLinkedInvoice(invoices, {
      invoiceId: '   ',
      linkedInvoiceId: '',
      linkedInvoiceRef: '  ',
    })).toBeUndefined()
  })

  it('finds an invoice that names the repair or its sale order', () => {
    const list = [
      { id: 'other', ref: 'INV/2026/0001', status: 'posted', type: 'customer_invoice' },
      { id: 'draft', ref: 'INV/2026/0010', status: 'draft', type: 'customer_invoice', repairId: 'r1' },
      { id: 'old', ref: 'INV/2026/0011', status: 'posted', type: 'customer_invoice', saleOrderId: 'so1', date: '2026-10-01' },
      { id: 'new', ref: 'INV/2026/0012', status: 'posted', type: 'customer_invoice', saleOrderId: 'so1', date: '2026-10-05' },
      { id: 'void', ref: 'INV/2026/0013', status: 'cancelled', type: 'customer_invoice', repairId: 'r1', date: '2026-10-09' },
    ]
    expect(findRepairLinkedInvoice(list, { id: 'r1', saleOrderId: 'so1' })?.id).toBe('new')
    expect(findRepairLinkedInvoice(list, { id: 'r1', saleOrderId: 'so1', previousInvoiceIds: ['new'] })?.id).toBe('old')
    expect(findRepairLinkedInvoice(list, { id: 'r9' })).toBeUndefined()
  })
})
