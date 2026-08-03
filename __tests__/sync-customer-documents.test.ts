import { describe, it, expect } from 'vitest'
import {
  applyCustomerToInvoice,
  applyCustomerToQuote,
  applyCustomerToSaleOrder,
  formatCustomerAddress,
  quoteMatchesCustomer,
  shouldSyncInvoiceCustomer,
  shouldSyncQuoteCustomer,
  shouldSyncSaleOrderCustomer,
} from '@/lib/sync-customer-documents'

describe('sync-customer-documents', () => {
  it('formats address lines', () => {
    expect(formatCustomerAddress({ address: 'Sanlam House', city: 'Nairobi', country: 'Kenya' }))
      .toBe('Sanlam House, Nairobi, Kenya')
    expect(formatCustomerAddress({ address: '', city: '', country: '' })).toBeUndefined()
  })

  it('skips terminal quote / SO / invoice statuses', () => {
    expect(shouldSyncQuoteCustomer('sent')).toBe(true)
    expect(shouldSyncQuoteCustomer('rejected')).toBe(false)
    expect(shouldSyncSaleOrderCustomer('quotation')).toBe(true)
    expect(shouldSyncSaleOrderCustomer('cancelled')).toBe(false)
    expect(shouldSyncInvoiceCustomer('posted')).toBe(true)
    expect(shouldSyncInvoiceCustomer('cancelled')).toBe(false)
  })

  it('matches quotes by companyId or clientId', () => {
    expect(quoteMatchesCustomer({ companyId: 'c1' }, 'c1')).toBe(true)
    expect(quoteMatchesCustomer({ clientId: 'c1' }, 'c1')).toBe(true)
    expect(quoteMatchesCustomer({ companyId: 'x' }, 'c1')).toBe(false)
  })

  it('applies identity patches to quote / SO / invoice snapshots', () => {
    expect(applyCustomerToQuote(
      { companyName: 'Old', contactPersonEmail: 'a@old.com', contactPersonPhone: '1' },
      { name: 'Tica Health', email: 'b@new.com', phone: '2' },
    )).toEqual({
      companyName: 'Tica Health',
      contactPersonEmail: 'b@new.com',
      contactPersonPhone: '2',
    })

    expect(applyCustomerToSaleOrder(
      { customerName: 'Old', customerId: 'c1', invoiceAddress: 'Old Rd' },
      { name: 'Tica Health', customerId: 'c1', address: 'New Rd, Nairobi' },
    )).toMatchObject({
      customerName: 'Tica Health',
      invoiceAddress: 'New Rd, Nairobi',
    })

    expect(applyCustomerToInvoice(
      { partnerName: 'Old', partnerId: 'c1' },
      { name: 'Tica Health', customerId: 'c1', address: 'New Rd' },
    )).toMatchObject({
      partnerName: 'Tica Health',
      invoiceAddress: 'New Rd',
    })
  })
})
