/**
 * Business-rule tests for addDepositReceipt (deposit-service):
 * caps payment at remaining balance, transitions partially_paid → fully_paid,
 * rejects closed deposits and non-positive amounts, posts Dr cash / Cr 3100.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma, mockCreateJournal } = vi.hoisted(() => {
  const mockPrisma: any = {
    deposit: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    depositPayment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    accountCode: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    journal: { findUnique: vi.fn().mockResolvedValue({ id: 'jnl-1' }) },
    journalEntry: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'je-1' }) },
    financialAuditEvent: { create: vi.fn() },
    fiscalLock: { findFirst: vi.fn().mockResolvedValue(null) },
    fiscalPeriod: { findFirst: vi.fn().mockResolvedValue({ state: 'open' }) },
  }
  mockPrisma.$transaction = vi.fn((fn: any) => fn(mockPrisma))
  return { mockPrisma, mockCreateJournal: vi.fn() }
})

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { addDepositReceipt } from '@/lib/accounting/deposit-service'

const DEPOSIT_ID = 'dep00001-0000-4000-8000-000000000001'
const actor = { id: 'user0001-0000-4000-8000-000000000001', name: 'Finance Officer' }

function makeDeposit(overrides: Record<string, unknown> = {}) {
  return {
    id: DEPOSIT_ID,
    ref: 'DEP/0001',
    totalValue: 80000,
    totalPaid: 20000,
    balance: 60000,
    status: 'partially_paid',
    currencyCode: 'KES',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.fiscalLock.findFirst.mockResolvedValue(null)
  mockPrisma.fiscalPeriod.findFirst.mockResolvedValue({ state: 'open' })
  mockPrisma.depositPayment.findUnique.mockResolvedValue(null)
  mockPrisma.depositPayment.create.mockResolvedValue({ id: 'pay-1', paidAt: new Date() })
  mockPrisma.depositPayment.update.mockResolvedValue({})
  mockPrisma.deposit.update.mockResolvedValue({})
  mockPrisma.journal.findUnique.mockResolvedValue({ id: 'jnl-1' })
  mockPrisma.journalEntry.findUnique.mockResolvedValue(null)
  mockPrisma.journalEntry.create.mockResolvedValue({ id: 'je-1' })
  mockPrisma.accountCode.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve({ id: `acct-${where.code}`, isActive: true }))
  mockPrisma.financialAuditEvent.create.mockResolvedValue({})
  mockPrisma.deposit.findUniqueOrThrow.mockResolvedValue(makeDeposit())
})

describe('addDepositReceipt', () => {
  it('caps the payment at the remaining balance', async () => {
    await addDepositReceipt({ depositId: DEPOSIT_ID, amount: 999999, method: 'cash', actor })
    expect(mockPrisma.depositPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 60000 }) }),
    )
  })

  it('transitions to fully_paid when the balance reaches zero', async () => {
    await addDepositReceipt({ depositId: DEPOSIT_ID, amount: 60000, method: 'cash', actor })
    expect(mockPrisma.deposit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'fully_paid', balance: 0 }) }),
    )
  })

  it('stays partially_paid while a balance remains', async () => {
    await addDepositReceipt({ depositId: DEPOSIT_ID, amount: 20000, method: 'cash', actor })
    expect(mockPrisma.deposit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'partially_paid', totalPaid: 40000, balance: 40000 }) }),
    )
  })

  it('rejects payments on a fully paid deposit', async () => {
    mockPrisma.deposit.findUniqueOrThrow.mockResolvedValue(makeDeposit({ status: 'fully_paid', balance: 0 }))
    await expect(addDepositReceipt({ depositId: DEPOSIT_ID, amount: 100, method: 'cash', actor }))
      .rejects.toThrow(/status/i)
    expect(mockPrisma.depositPayment.create).not.toHaveBeenCalled()
  })

  it('rejects a zero amount', async () => {
    await expect(addDepositReceipt({ depositId: DEPOSIT_ID, amount: 0, method: 'cash', actor }))
      .rejects.toThrow(/greater than zero/i)
  })

  it('returns the existing deposit for a repeated idempotency key', async () => {
    mockPrisma.depositPayment.findUnique.mockResolvedValue({ id: 'pay-1', depositId: DEPOSIT_ID })
    await addDepositReceipt({ depositId: DEPOSIT_ID, amount: 5000, method: 'cash', idempotencyKey: 'k-1', actor })
    expect(mockPrisma.depositPayment.create).not.toHaveBeenCalled()
  })

  it('posts Dr cash / Cr customer deposits (3100) journal', async () => {
    await addDepositReceipt({ depositId: DEPOSIT_ID, amount: 20000, method: 'mpesa', actor })
    expect(mockPrisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ accountLabel: expect.stringContaining('2211'), debit: 20000 }),
              expect.objectContaining({ accountLabel: expect.stringContaining('3100'), credit: 20000 }),
            ]),
          }),
        }),
      }),
    )
  })
})
