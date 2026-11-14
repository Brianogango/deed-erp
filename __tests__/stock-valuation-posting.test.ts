import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COA_ROLE_CODES, labelForRole } from '@/lib/accounting/coa-roles'

const { mockPersist } = vi.hoisted(() => ({
  mockPersist: vi.fn(),
}))

vi.mock('@/lib/accounting/journal-service', () => ({
  persistStoreJournalEntry: mockPersist,
  reverseJournalEntry: vi.fn(),
  createJournalEntry: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockPersist.mockResolvedValue({ id: 'je-stk', ref: 'JRN/STK/RCV-1' })
})

describe('stock CoA roles', () => {
  it('maps inventory / cogs / grni to live codes', () => {
    expect(COA_ROLE_CODES.inventory).toBe('1200')
    expect(COA_ROLE_CODES.cogs).toBe('6001')
    expect(COA_ROLE_CODES.grni).toBe('3201')
    expect(labelForRole('inventory')).toBe('1200 - Inventory')
    expect(labelForRole('cogs')).toBe('6001 - Cost of Goods Sold')
  })
})


