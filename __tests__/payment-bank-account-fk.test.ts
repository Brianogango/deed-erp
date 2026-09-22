import { describe, it, expect } from 'vitest'
import { bankAccountFk } from '@/lib/accounting/bank-account-ref'
import { cashAccountRoleForBankId } from '@/lib/accounting/coa-roles'

describe('bank_account_id foreign key', () => {
  it('REGRESSION 22-Sep-2026: legacy cashbook ids are not written to a uuid column', () => {
    // prisma.payment.create() failed with
    // `invalid input syntax for type uuid: "im"`, rolling back the whole
    // receipt while the browser had already shown it as paid.
    for (const legacy of ['im', 'ncba', 'absa', 'mpesa', 'petty_cash', '']) {
      expect(bankAccountFk(legacy)).toBeNull()
    }
    expect(bankAccountFk(null)).toBeNull()
    expect(bankAccountFk(undefined)).toBeNull()
    expect(bankAccountFk(12345)).toBeNull()
  })

  it('keeps a real bank-account id', () => {
    const id = '3f8c3677-1a2b-4c3d-8e4f-5a6b7c8d9e0f'
    expect(bankAccountFk(id)).toBe(id)
    expect(bankAccountFk(id.toUpperCase())).toBe(id.toUpperCase())
  })

  it('the legacy id still selects the cash/bank GL account', () => {
    // Dropping the FK must not change which account the journal posts to.
    expect(cashAccountRoleForBankId('im')).toBe('bank_absa')
    expect(cashAccountRoleForBankId('mpesa')).toBe('cash_mobile')
  })
})
