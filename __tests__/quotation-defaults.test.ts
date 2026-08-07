import { describe, expect, it } from 'vitest'
import {
  quotationPaymentTermsDays,
  quotationPaymentTermsLabel,
  serializeQuotationPaymentTerms,
} from '@/lib/sales/quotation-defaults'

describe('quotation payment terms defaults', () => {
  it('uses immediate payment when the contact has no configured terms', () => {
    expect(quotationPaymentTermsDays(undefined)).toBe(0)
    expect(quotationPaymentTermsDays({})).toBe(0)
    expect(quotationPaymentTermsLabel(0)).toBe('Immediate')
    expect(serializeQuotationPaymentTerms(0)).toBe('Immediate')
  })

  it('uses the selected contact payment term limit', () => {
    expect(quotationPaymentTermsDays({ paymentTermsDays: 30 })).toBe(30)
    expect(quotationPaymentTermsLabel(30)).toBe('Net 30')
    expect(serializeQuotationPaymentTerms(30)).toBe('30 days')
  })

  it('supports legacy contact payment-term strings', () => {
    expect(quotationPaymentTermsDays({ paymentTerms: 'Net 45' })).toBe(45)
    expect(quotationPaymentTermsDays({ paymentTerms: '60 days' })).toBe(60)
    expect(quotationPaymentTermsDays({ paymentTerms: 'not configured' })).toBe(0)
  })
})
