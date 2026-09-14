import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma: any = {
    fiscalLock: { findFirst: vi.fn() },
    fiscalPeriod: { findFirst: vi.fn() },
    journal: { findUnique: vi.fn(), create: vi.fn() },
    journalEntry: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    accountCode: { findUnique: vi.fn() },
    analyticAccount: { findUnique: vi.fn() },
  }
  return { mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { createJournalEntry } from '@/lib/accounting/journal-service'

const balancedLines = [
  { accountLabel: '2211 - Petty Cash / Mobile Money', debit: 100, credit: 0 },
  { accountLabel: '5000 - Sales Revenue', debit: 0, credit: 100 },
]

function coveringWhere(state?: string) {
  return expect.objectContaining({
    dateFrom: expect.objectContaining({ lte: expect.any(Date) }),
    dateTo: expect.objectContaining({ gte: expect.any(Date) }),
    ...(state ? { state } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.fiscalLock.findFirst.mockResolvedValue(null)
  mockPrisma.fiscalPeriod.findFirst.mockImplementation(async ({ where }: any) => {
    if (where?.state === 'open') return { id: 'fp-open', name: '2026', state: 'open' }
    return { id: 'fp-open', name: '2026', state: 'open' }
  })
  mockPrisma.journal.findUnique.mockResolvedValue({ id: 'jnl-csh' })
  mockPrisma.journal.create.mockResolvedValue({ id: 'jnl-created' })
  mockPrisma.journalEntry.findUnique.mockResolvedValue(null)
  mockPrisma.journalEntry.findFirst.mockResolvedValue(null)
  mockPrisma.journalEntry.create.mockResolvedValue({ id: 'je-1', ref: 'JRN/POS-1' })
  mockPrisma.accountCode.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve({ id: `acct-${where.code}`, isActive: true }))
})

describe('createJournalEntry fiscal periods', () => {
  it('posts when the covering period is still draft', async () => {
    mockPrisma.fiscalPeriod.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.state === 'open') return null
      return { id: 'fp-draft', name: '2026', state: 'draft' }
    })

    await expect(createJournalEntry({
      ref: 'JRN/POS-DRAFT',
      journalCode: 'CSH',
      date: '2026-09-13',
      description: 'POS sale',
      sourceType: 'pos',
      lines: balancedLines,
    })).resolves.toMatchObject({ id: 'je-1' })

    expect(mockPrisma.journalEntry.create).toHaveBeenCalled()
    expect(mockPrisma.fiscalPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: coveringWhere('open') }),
    )
  })

  it('posts when a draft period overlaps an open year', async () => {
    mockPrisma.fiscalPeriod.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.state === 'open') return { id: 'fp-open', name: '2026', state: 'open' }
      return { id: 'fp-draft', name: 'FY2026-draft', state: 'draft' }
    })

    await expect(createJournalEntry({
      ref: 'JRN/POS-OVERLAP',
      journalCode: 'CSH',
      date: '2026-09-13',
      description: 'POS sale',
      sourceType: 'pos',
      lines: balancedLines,
    })).resolves.toMatchObject({ id: 'je-1' })
  })

  it('rejects postings into a closed period', async () => {
    mockPrisma.fiscalPeriod.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.state === 'open') return null
      return { id: 'fp-closed', name: '2025', state: 'closed' }
    })

    await expect(createJournalEntry({
      ref: 'JRN/POS-CLOSED',
      journalCode: 'CSH',
      date: '2025-12-31',
      description: 'POS sale',
      sourceType: 'pos',
      lines: balancedLines,
    })).rejects.toThrow(/Fiscal period 2025 is closed/)
    expect(mockPrisma.journalEntry.create).not.toHaveBeenCalled()
  })
})

describe('createJournalEntry operational journals', () => {
  it('creates a missing STK journal instead of blocking stock COGS', async () => {
    mockPrisma.journal.findUnique.mockResolvedValueOnce(null)
    mockPrisma.journal.create.mockResolvedValue({ id: 'jnl-stk-new' })

    await createJournalEntry({
      ref: 'JRN/STK/DN-1',
      journalCode: 'STK',
      date: '2026-09-13',
      description: 'Delivery COGS',
      sourceType: 'stock_delivery',
      lines: [
        { accountLabel: '6001 - Cost of Goods Sold', debit: 50, credit: 0 },
        { accountLabel: '1200 - Inventory', debit: 0, credit: 50 },
      ],
    })

    expect(mockPrisma.journal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'STK',
          name: 'Stock Journal',
          journalType: 'stock',
          isActive: true,
        }),
      }),
    )
    expect(mockPrisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ journalId: 'jnl-stk-new' }),
      }),
    )
  })

  it('still rejects unknown non-operational journal codes', async () => {
    mockPrisma.journal.findUnique.mockResolvedValue(null)

    await expect(createJournalEntry({
      ref: 'JRN/XYZ-1',
      journalCode: 'XYZ',
      date: '2026-09-13',
      description: 'Bad book',
      sourceType: 'manual',
      lines: balancedLines,
    })).rejects.toThrow(/Unknown journal code: XYZ/)
    expect(mockPrisma.journal.create).not.toHaveBeenCalled()
    expect(mockPrisma.journalEntry.create).not.toHaveBeenCalled()
  })
})
