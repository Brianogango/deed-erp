import { beforeEach, describe, expect, it, vi } from 'vitest'

const { persist, cashLabel } = vi.hoisted(() => ({
  persist: vi.fn(async (entry: unknown) => entry),
  cashLabel: vi.fn(async () => '1015 - Tende Bank'),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: {} }))
vi.mock('@/lib/accounting/journal-service', () => ({
  persistStoreJournalEntry: persist,
  persistStoreJournalEntryInTx: vi.fn(),
  reverseJournalEntry: vi.fn(),
}))
vi.mock('@/lib/accounting/bank-cash-account.server', () => ({ cashLabelForBankAccount: cashLabel }))

import { postPosSale } from '@/lib/accounting/posting-service'

beforeEach(() => { persist.mockClear(); cashLabel.mockClear() })

const sale = { orderId: 'o1', orderRef: 'POS/0100', total: 1000, subtotal: 1000, tax: 0, paymentMethod: 'bank' }

describe('POS sale into a cashbook account', () => {
  it('posts an account added on the Bank accounts screen to its own GL account', async () => {
    await postPosSale({ ...sale, bankAccountId: '6f1c2a3b-1111-4222-8333-944455556666' })
    const lines = (persist.mock.calls[0][0] as { lines: Array<{ account: string; debit: number }> }).lines
    expect(lines.find(l => l.debit > 0)?.account).toBe('1015 - Tende Bank')
  })

  it('keeps the built-in accounts on the role map', async () => {
    await postPosSale({ ...sale, bankAccountId: 'mpesa', paymentMethod: 'mpesa' })
    expect(cashLabel).not.toHaveBeenCalled()
  })
})
