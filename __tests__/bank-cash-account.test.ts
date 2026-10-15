import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLoadAppState } = vi.hoisted(() => ({ mockLoadAppState: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({ loadAppState: mockLoadAppState }))

import { BankAccountRefError, cashLabelForBankAccount } from '@/lib/accounting/bank-cash-account.server'

const TENDE = '7b0d9a52-3c1e-4f7a-9a51-2f0f5d6e8c11'
const SEEDED = '0f6c2c55-1b7e-4b3d-8a2e-5d8c9e1f2a33'

function db(rows: { bank?: any; byName?: any; gl?: any } = {}) {
  return {
    bankAccount: {
      findUnique: vi.fn(async () => rows.bank ?? null),
      findFirst: vi.fn(async () => rows.byName ?? null),
    },
    accountCode: { findUnique: vi.fn(async () => rows.gl ?? null) },
  } as any
}

describe('cashLabelForBankAccount', () => {
  beforeEach(() => {
    mockLoadAppState.mockReset()
    mockLoadAppState.mockResolvedValue({
      deed_bankAccounts: [
        { id: 'im', name: 'I&M Current Account', active: true },
        { id: TENDE, name: 'Tende', bankName: 'Tende', active: true },
        { id: 'b3f1c2d4-0000-4000-8000-000000000001', name: 'Old wallet', active: false },
      ],
    })
  })

  it('built-in cashbook ids use the role map without a lookup', async () => {
    const d = db()
    expect(await cashLabelForBankAccount(d, 'im')).toBe('2201 - ABSA Bank')
    expect(d.bankAccount.findUnique).not.toHaveBeenCalled()
  })

  it('a bank_accounts row posts to its own GL', async () => {
    const d = db({ bank: { id: SEEDED, isActive: true, glAccountId: 'gl1' }, gl: { code: '2201', name: 'Bank', isActive: true } })
    expect(await cashLabelForBankAccount(d, SEEDED)).toBe('2201 - Bank')
  })

  it('an account added on the Bank accounts screen (Tende) is accepted', async () => {
    expect(await cashLabelForBankAccount(db(), TENDE)).toBe('2201 - ABSA Bank')
  })

  it('prefers a bank_accounts row with the same name', async () => {
    const d = db({ byName: { isActive: true, glAccountId: 'gl2' }, gl: { code: '2211', name: 'Mobile Money', isActive: true } })
    expect(await cashLabelForBankAccount(d, TENDE)).toBe('2211 - Mobile Money')
  })

  it('refuses unknown and inactive accounts', async () => {
    await expect(cashLabelForBankAccount(db(), '11111111-2222-4333-8444-555555555555')).rejects.toBeInstanceOf(BankAccountRefError)
    await expect(cashLabelForBankAccount(db(), 'b3f1c2d4-0000-4000-8000-000000000001')).rejects.toThrow('Invalid or inactive bank account')
    await expect(cashLabelForBankAccount(db({ bank: { isActive: false } }), SEEDED)).rejects.toThrow('Invalid or inactive bank account')
  })
})
