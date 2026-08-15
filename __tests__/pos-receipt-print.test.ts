import { describe, expect, it } from 'vitest'
import {
  PACKAGED_POS_RECEIPT_LOGO,
  isWalkInCustomerName,
  receiptLogoSrc,
  resolvePosReceiptCustomer,
} from '@/lib/pos-receipt-print'

describe('isWalkInCustomerName', () => {
  it('treats empty and walk-in labels as unnamed', () => {
    expect(isWalkInCustomerName('')).toBe(true)
    expect(isWalkInCustomerName('Walk-in')).toBe(true)
    expect(isWalkInCustomerName('Walk-in Customer')).toBe(true)
    expect(isWalkInCustomerName('Juma')).toBe(false)
  })
})

describe('receiptLogoSrc', () => {
  it('uses the black Deed Technologies lockup, not the ERP placeholder bars', () => {
    expect(PACKAGED_POS_RECEIPT_LOGO).toBe('/deed-logo-receipt.png')
    expect(receiptLogoSrc('')).toBe(PACKAGED_POS_RECEIPT_LOGO)
    expect(receiptLogoSrc(null)).toBe(PACKAGED_POS_RECEIPT_LOGO)
    expect(receiptLogoSrc('/deed-logo.svg')).toBe(PACKAGED_POS_RECEIPT_LOGO)
    expect(receiptLogoSrc('/deed-logo.png')).toBe(PACKAGED_POS_RECEIPT_LOGO)
  })

  it('keeps an uploaded company logo data URL', () => {
    expect(receiptLogoSrc('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
  })
})

describe('resolvePosReceiptCustomer', () => {
  it('uses the ticket buyer when it is a real name', () => {
    expect(resolvePosReceiptCustomer({ customerName: 'Juma' })).toBe('Juma')
  })

  it('fills a walk-in ticket from the linked invoice without writing anything', () => {
    expect(resolvePosReceiptCustomer(
      { customerName: 'Walk-in Customer', invoiceRef: 'INV/2026/0087', ref: 'POS/0019' },
      [{ ref: 'INV/2026/0087', partnerName: 'Juma', notes: 'POS POS/0019' }],
    )).toBe('Juma')
  })

  it('keeps Walk-in Customer when the invoice is also unnamed', () => {
    expect(resolvePosReceiptCustomer(
      { customerName: 'Walk-in', invoiceRef: 'INV/2026/0087' },
      [{ ref: 'INV/2026/0087', partnerName: 'Walk-in Customer' }],
    )).toBe('Walk-in')
  })
})
