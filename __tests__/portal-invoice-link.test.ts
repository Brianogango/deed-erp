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
})
