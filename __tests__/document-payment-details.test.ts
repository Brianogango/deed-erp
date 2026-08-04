import { describe, it, expect } from 'vitest'
import {
  buildPaymentDetailLines,
  normalizeDocumentPaymentDetails,
  summarizePaymentDetails,
  DEFAULT_DOCUMENT_PAYMENT_DETAILS,
} from '@/lib/document-payment-details'

const company = {
  name: 'Deed Technologies LTD',
  mpesaPaybill: '880100',
  mpesaAccount: '468778',
  currency: 'KES',
}

const banks = [
  {
    id: 'ncba',
    name: 'NCBA Current',
    bankName: 'NCBA BANK KENYA PLC',
    accountNo: '1005157785',
    currency: 'KES',
    openingBalance: 0,
    openingDate: '2026-01-01',
    active: true,
  },
  {
    id: 'equity',
    name: 'Equity Ops',
    bankName: 'Equity Bank',
    accountNo: '0123456789',
    currency: 'KES',
    openingBalance: 0,
    openingDate: '2026-01-01',
    active: true,
  },
  {
    id: 'cash',
    name: 'Cash',
    bankName: 'Cash',
    accountNo: 'CASH',
    currency: 'KES',
    openingBalance: 0,
    openingDate: '2026-01-01',
    active: true,
  },
]

describe('document payment details', () => {
  it('normalizes missing values to company default', () => {
    expect(normalizeDocumentPaymentDetails(null)).toEqual(DEFAULT_DOCUMENT_PAYMENT_DETAILS)
    expect(normalizeDocumentPaymentDetails({ useCompanyDefault: false, bankAccountIds: ['ncba'] })).toMatchObject({
      useCompanyDefault: false,
      bankAccountIds: ['ncba'],
      includeMpesa: true,
    })
  })

  it('builds default payment lines from first bank + M-Pesa', () => {
    const lines = buildPaymentDetailLines({
      details: { useCompanyDefault: true },
      company,
      bankAccounts: banks,
      documentRef: 'QUO/2026/0001',
    })
    expect(lines[0]).toBe('Payment Reference: QUO/2026/0001')
    expect(lines).toContain('Bank Transfer:')
    expect(lines).toContain('Account Number: 1005157785 (KES)')
    expect(lines).toContain('M-PESA:')
    expect(lines).toContain('Pay Bill No: 880100')
    expect(lines.join('\n')).not.toContain('0123456789')
  })

  it('builds custom selection with second bank only and no M-Pesa', () => {
    const lines = buildPaymentDetailLines({
      details: {
        useCompanyDefault: false,
        bankAccountIds: ['equity'],
        includeMpesa: false,
        customNote: 'Pay using the quotation number',
      },
      company,
      bankAccounts: banks,
      documentRef: 'PI/2026/0003',
    })
    expect(lines).toContain('Account Number: 0123456789 (KES)')
    expect(lines.join('\n')).not.toContain('1005157785')
    expect(lines.join('\n')).not.toContain('M-PESA:')
    expect(lines).toContain('Pay using the quotation number')
  })

  it('summarizes the custom payment note for the UI', () => {
    expect(summarizePaymentDetails({ useCompanyDefault: true }, banks, company)).toBe('Company payment defaults')
    expect(
      summarizePaymentDetails(
        { useCompanyDefault: true, customNote: 'Pay via NCBA\nUse quote ref' },
        banks,
        company,
      ),
    ).toBe('Pay via NCBA')
  })
})
