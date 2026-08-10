import { describe, it, expect } from 'vitest'
import {
  alignPaymentDetailsToTax,
  banksByPaymentRole,
  buildPaymentDetailLines,
  documentHasVat,
  normalizeDocumentPaymentDetails,
  resolvePaymentBankRole,
  summarizePaymentDetails,
  DEFAULT_DOCUMENT_PAYMENT_DETAILS,
} from '@/lib/document-payment-details'

const company = {
  name: 'Deed Technologies LTD',
  mpesaPaybill: '880100',
  mpesaAccount: '468778',
  currency: 'KES',
}

/** Mirrors Contabo production where ABSA/I&M reuse legacy ids. */
const prodStyleBanks = [
  {
    id: 'ncba',
    name: 'Deed Technologies Ltd',
    bankName: 'NCBA Bank Kenya PLC',
    accountNo: '1005157785',
    currency: 'KES',
    openingBalance: 0,
    openingDate: '2026-01-01',
    active: true,
  },
  {
    id: 'equity',
    name: 'Deed Technologies Ltd',
    bankName: 'Equity Bank Kenya',
    accountNo: '0020284195905',
    currency: 'KES',
    openingBalance: 0,
    openingDate: '2026-01-01',
    active: true,
  },
  {
    id: 'kcb',
    name: 'Deed Technologies Ltd',
    bankName: 'I & M Bank',
    accountNo: '00105512776350',
    currency: 'KES',
    openingBalance: 0,
    openingDate: '2026-01-01',
    active: true,
  },
  {
    id: 'mpesa',
    name: 'Deed Technologies Ltd',
    bankName: 'ABSA',
    accountNo: '2043953071',
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

  it('detects VAT from taxTotal or line taxRate', () => {
    expect(documentHasVat({ taxTotal: 100 })).toBe(true)
    expect(documentHasVat({ taxTotal: 0, lines: [{ taxRate: 16 }] })).toBe(true)
    expect(documentHasVat({ taxTotal: 0, lines: [{ taxRate: 0 }] })).toBe(false)
  })

  it('resolves NCBA / ABSA / I&M by bank name even with legacy ids', () => {
    const roles = banksByPaymentRole(prodStyleBanks)
    expect(roles.ncba?.accountNo).toBe('1005157785')
    expect(roles.absa?.id).toBe('mpesa')
    expect(roles.im?.id).toBe('kcb')
    expect(resolvePaymentBankRole(prodStyleBanks[3]!)).toBe('absa')
  })

  it('forces NCBA for VAT documents and ABSA default for non-VAT', () => {
    const vat = alignPaymentDetailsToTax({ useCompanyDefault: true }, true, prodStyleBanks)
    expect(vat).toMatchObject({
      useCompanyDefault: false,
      bankAccountIds: ['ncba'],
      includeMpesa: true,
    })

    const nonVat = alignPaymentDetailsToTax({ useCompanyDefault: true }, false, prodStyleBanks)
    expect(nonVat).toMatchObject({
      useCompanyDefault: false,
      bankAccountIds: ['mpesa'], // ABSA row
      includeMpesa: true,
    })

    const keepIm = alignPaymentDetailsToTax(
      { useCompanyDefault: false, bankAccountIds: ['kcb'], includeMpesa: true },
      false,
      prodStyleBanks,
    )
    expect(keepIm.bankAccountIds).toEqual(['kcb'])
  })

  it('builds VAT invoice lines for NCBA + M-Pesa', () => {
    const details = alignPaymentDetailsToTax(null, true, prodStyleBanks)
    const lines = buildPaymentDetailLines({
      details,
      company,
      bankAccounts: prodStyleBanks,
      documentRef: 'INV/2026/0054',
    })
    expect(lines).toContain('Account Number: 1005157785 (KES)')
    expect(lines).toContain('Bank: NCBA Bank Kenya PLC')
    expect(lines).toContain('M-PESA:')
    expect(lines.join('\n')).not.toContain('2043953071')
  })

  it('summarizes selected bank role for the UI', () => {
    expect(summarizePaymentDetails({ useCompanyDefault: true }, banks, company)).toBe('NCBA')
    expect(
      summarizePaymentDetails(
        { useCompanyDefault: false, bankAccountIds: ['mpesa'], customNote: 'Use invoice ref' },
        prodStyleBanks,
        company,
      ),
    ).toBe('ABSA — Use invoice ref')
  })
})
