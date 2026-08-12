import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertPostingBalanced,
  buildStockCogsLines,
  buildStockCustomerReturnLines,
  buildStockReceiptLines,
  buildStockVendorReturnLines,
  postStockJournal,
  resolvePostingAccountLabel,
} from '@/lib/accounting/posting-service'
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

describe('stock posting builders', () => {
  it('builds balanced receipt with GRNI and optional variance', () => {
    const lines = buildStockReceiptLines({
      inventoryDebit: 1000,
      grniCredit: 1100,
      priceDiffLabel: '6210',
    })
    const resolved = lines.map(l => ({
      account: resolvePostingAccountLabel(l),
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
    }))
    expect(() => assertPostingBalanced(resolved)).not.toThrow()
    expect(resolved.find(l => l.account.includes('1200'))?.debit).toBe(1000)
    expect(resolved.find(l => l.account.includes('3201'))?.credit).toBe(1100)
    expect(resolved.find(l => l.account === '6210')?.debit).toBe(100)
  })

  it('builds COGS / inventory reduction lines', () => {
    const lines = buildStockCogsLines({ totalCost: 500 })
    expect(resolvePostingAccountLabel(lines[0])).toBe('6001 - Cost of Goods Sold')
    expect(resolvePostingAccountLabel(lines[1])).toBe('1200 - Inventory')
    expect(() => assertPostingBalanced(lines.map(l => ({
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
    })))).not.toThrow()
  })

  it('builds customer and vendor return lines', () => {
    const cust = buildStockCustomerReturnLines({ totalCost: 200 })
    expect(resolvePostingAccountLabel(cust[0])).toContain('1200')
    const vend = buildStockVendorReturnLines({ totalCost: 200 })
    expect(resolvePostingAccountLabel(vend[0])).toContain('3201')
  })
})

describe('postStockJournal', () => {
  it('commits STK journal via persistStoreJournalEntry', async () => {
    await postStockJournal({
      ref: 'JRN/STK/RCV/test',
      description: 'Stock receipt',
      sourceType: 'stock_receipt',
      sourceId: 'RCV-1',
      lines: buildStockReceiptLines({ inventoryDebit: 100, grniCredit: 100 }),
    })
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'JRN/STK/RCV/test',
        source: 'stock_receipt',
      }),
      expect.objectContaining({ journalCode: 'STK' }),
    )
  })
})
