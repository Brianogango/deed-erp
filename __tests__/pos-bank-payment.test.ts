import { describe, expect, it } from 'vitest'
import { isPosBankPayment } from '@/lib/pos-session'
import { bankAccountIdForPaymentMethod } from '@/lib/accounting/expense-pos-accounts'
import { cashAccountRoleForMethod } from '@/lib/accounting/coa-roles'

describe('POS bank tender', () => {
  it('treats bank and legacy card as bank payments', () => {
    expect(isPosBankPayment('bank')).toBe(true)
    expect(isPosBankPayment('card')).toBe(true)
    expect(isPosBankPayment('cash')).toBe(false)
    expect(isPosBankPayment('mpesa')).toBe(false)
  })

  it('resolves selected bank account id for journal tender', () => {
    expect(bankAccountIdForPaymentMethod('bank', 'absa')).toBe('absa')
    expect(bankAccountIdForPaymentMethod('bank')).toBe('ncba')
    expect(bankAccountIdForPaymentMethod('mpesa')).toBe('mpesa')
  })

  it('maps bank payment method to bank CoA role', () => {
    expect(cashAccountRoleForMethod('bank')).toBe('bank_absa')
  })
})
