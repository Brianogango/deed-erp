import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { accountCode: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() } },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/auth/api', () => ({ getRequiredSession: vi.fn() }))

import { accountBodySchema, accountData, findAccountByScreenId, loadScreenAccounts } from '@/lib/account-read-model.server'

const row = (over: Record<string, unknown> = {}) => ({
  id: '0b1c6f8e-1d2a-4c3b-9e8f-112233445566', code: '2201', name: 'Bank', accountType: 'asset',
  accountGroup: 'Cash at Bank', subGroup: null, isActive: true, isDynamic: false, dynamicKey: null,
  balance: 1500.5, notes: null, screenId: 'coa-2201', bankAccountId: 'bank-1',
  createdAt: new Date(), updatedAt: new Date(),
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('chart of accounts for the screens, read from account_codes', () => {
  it('keeps the id the screens used and maps the columns', async () => {
    mockPrisma.accountCode.findMany.mockResolvedValue([row()])
    const [a] = await loadScreenAccounts([{ id: 'coa-2201', code: '2201', name: 'Old name' }])
    expect(a).toEqual({ id: 'coa-2201', code: '2201', name: 'Bank', type: 'asset', group: 'Cash at Bank', isActive: true, balance: 1500.5, bankAccountId: 'bank-1' })
  })

  it('uses the table id for an account added after the freeze, and keeps copy-only accounts', async () => {
    mockPrisma.accountCode.findMany.mockResolvedValue([row({ screenId: null })])
    const list = await loadScreenAccounts([{ id: 'x', code: '9999', name: 'Only in copy' }])
    expect(list.map(a => a.id)).toEqual(['0b1c6f8e-1d2a-4c3b-9e8f-112233445566', 'x'])
  })

  it('finds an account by screen id, then by table id', async () => {
    mockPrisma.accountCode.findFirst.mockResolvedValue(null)
    mockPrisma.accountCode.findUnique.mockResolvedValue(row())
    await findAccountByScreenId('0b1c6f8e-1d2a-4c3b-9e8f-112233445566')
    expect(mockPrisma.accountCode.findUnique).toHaveBeenCalled()
    mockPrisma.accountCode.findUnique.mockClear()
    expect(await findAccountByScreenId('coa-missing')).toBeNull()
    expect(mockPrisma.accountCode.findUnique).not.toHaveBeenCalled()
  })

  it('writes only the fields sent; empty text clears', () => {
    const body = accountBodySchema.partial().parse({ name: 'Renamed', subGroup: '', balance: '12.345' })
    expect(accountData(body)).toEqual({ name: 'Renamed', subGroup: null, balance: 12.35 })
  })

  it('rejects an unknown account type', () => {
    expect(accountBodySchema.safeParse({ code: '1', name: 'X', type: 'income', group: 'G' }).success).toBe(false)
  })
})
