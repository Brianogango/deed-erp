import { describe, expect, it } from 'vitest'
import { bankChoiceLabel } from '@/lib/finance/bank-choice-label'

describe('bank account in a picker', () => {
  it('shows the bank and the last four digits, not the holder name', () => {
    expect(bankChoiceLabel({ name: 'Deed Technologies Ltd', bankName: 'NCBA Bank', accountNo: '1004 5621 4521' })).toBe('NCBA Bank · ••4521')
    expect(bankChoiceLabel({ name: 'Deed Technologies Ltd', bankName: 'Equity Bank', accountNo: '0450' })).toBe('Equity Bank · 0450')
  })
  it('an account with no bank reads as its own name', () => {
    expect(bankChoiceLabel({ name: 'Petty Cash Float', bankName: '', accountNo: '' })).toBe('Petty Cash Float')
    expect(bankChoiceLabel({ name: 'M-Pesa Paybill', bankName: null, accountNo: '522533' })).toBe('M-Pesa Paybill · ••2533')
  })
})
