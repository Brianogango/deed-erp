import { describe, expect, it } from 'vitest'
import { accountChoiceRequired, bankAccountLabel, paymentBank, reconciledStatementLine } from '@/lib/finance/payment-bank'

const banks = [
  { id: 'ncba', name: 'NCBA Current Account', bankName: 'NCBA Bank Kenya PLC', accountNo: '1001237890', active: true },
  { id: 'eq', name: 'Equity Business', bankName: 'Equity Bank', accountNo: '0170-29-123-4567', active: true },
  { id: 'mpesa', name: 'M-Pesa Paybill', bankName: 'Safaricom M-Pesa', accountNo: '247247', active: true },
  { id: 'cash', name: 'Petty Cash Float', bankName: 'Cash', accountNo: 'CASH', active: true },
]

describe('payment bank', () => {
  it('shows the chosen account with its last four digits', () => {
    expect(paymentBank({ method: 'bank_transfer', bankAccountId: 'eq' }, banks)).toEqual({ id: 'eq', label: 'Equity Business ••4567', isDefault: false })
  })
  it('marks the default the books used when none was chosen', () => {
    expect(paymentBank({ method: 'mpesa' }, banks)).toMatchObject({ id: 'mpesa', isDefault: true, label: 'M-Pesa Paybill ••7247' })
    expect(paymentBank({ method: 'cash' }, banks)).toMatchObject({ id: 'cash', label: 'Petty Cash Float', isDefault: true })
    expect(paymentBank({ method: 'bank_transfer' }, banks)).toMatchObject({ id: 'ncba', isDefault: true })
  })
  it('has no bank when no money moved (a credit applied)', () => {
    expect(paymentBank({ method: 'customer_credit' }, banks)).toBeNull()
  })
  it('falls back to the id for an account no longer listed', () => {
    expect(bankAccountLabel(undefined, 'old-acct')).toBe('old-acct')
  })
  it('finds the statement line a payment is matched to', () => {
    const lines = [{ id: 'l1', matchedEntryId: 'inv-pay-i1-p1', date: '2026-11-14' }, { id: 'l2' }]
    expect(reconciledStatementLine(lines, 'i1', 'p1')?.id).toBe('l1')
    expect(reconciledStatementLine(lines, 'i1', 'p2')).toBeNull()
  })
  it('asks which account only when there are several of that kind', () => {
    expect(accountChoiceRequired('mpesa', banks)).toBe(false)
    expect(accountChoiceRequired('mpesa', [...banks, { id: 'till', name: 'M-Pesa Till', bankName: 'Safaricom M-Pesa', accountNo: '5123456', active: true }])).toBe(true)
    expect(accountChoiceRequired('cash', [...banks, { id: 'c2', name: 'Shop till cash', bankName: 'Cash', accountNo: 'CASH', active: true }])).toBe(true)
  })
})
