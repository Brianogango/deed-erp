import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertPostingBalanced,
  buildExpenseApprovalLines,
  buildExpenseReimbursementLines,
  buildPosSaleLines,
  postExpenseApproval,
  postExpenseReimbursement,
  postPosSale,
  resolvePostingAccountLabel,
} from '@/lib/accounting/posting-service'
import {
  bankAccountLabelForId,
  expenseAccountForCategory,
} from '@/lib/accounting/expense-pos-accounts'
import { labelForRole } from '@/lib/accounting/coa-roles'

const { mockPersist } = vi.hoisted(() => ({
  mockPersist: vi.fn(),
}))

vi.mock('@/lib/accounting/journal-service', () => ({
  persistStoreJournalEntry: mockPersist,
  reverseJournalEntry: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockPersist.mockResolvedValue({ id: 'je-1', ref: 'JRN/EXP/EXP-1' })
})

describe('expense-pos account helpers', () => {
  it('maps expense categories to historical labels', () => {
    expect(expenseAccountForCategory('courier')).toBe('6420 - Courier & Delivery')
    expect(expenseAccountForCategory('unknown')).toBe('6499 - Other Operating Expenses')
  })

  it('maps bank ids to cashbook labels', () => {
    expect(bankAccountLabelForId('mpesa')).toBe('2211 - Petty Cash / Mobile Money')
    expect(bankAccountLabelForId('ncba')).toBe('2201 - ABSA Bank')
  })
})

describe('expense / POS builders', () => {
  it('builds reimbursement approval (Dr expense, Cr 3105)', () => {
    const lines = buildExpenseApprovalLines({
      amount: 2500,
      ref: 'EXP-9',
      description: 'Taxi',
      category: 'transport',
      paymentMethod: 'reimbursement',
      submittedByName: 'Ada',
    })
    const resolved = lines.map(l => ({
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      account: resolvePostingAccountLabel(l),
    }))
    expect(() => assertPostingBalanced(resolved)).not.toThrow()
    expect(resolved[0].account).toBe('6400 - Transport & Fuel')
    expect(resolved[1].account).toBe(labelForRole('employee_reimbursements'))
  })

  it('builds company-paid approval against M-Pesa', () => {
    const lines = buildExpenseApprovalLines({
      amount: 800,
      ref: 'EXP-10',
      description: 'Courier',
      category: 'courier',
      paymentMethod: 'mpesa',
    })
    expect(resolvePostingAccountLabel(lines[1])).toBe('2211 - Petty Cash / Mobile Money')
  })

  it('builds reimbursement payout (Dr 3105, Cr bank)', () => {
    const lines = buildExpenseReimbursementLines({
      amount: 2500,
      ref: 'EXP-9',
      submittedByName: 'Ada',
      bankAccountId: 'ncba',
    })
    expect(resolvePostingAccountLabel(lines[0])).toBe('3105 - Employee Reimbursements Payable')
    expect(resolvePostingAccountLabel(lines[1])).toBe('2201 - ABSA Bank')
  })

  it('maps legacy KCB tender ids onto an existing canonical bank account', () => {
    expect(bankAccountLabelForId('kcb')).toBe('2201 - ABSA Bank')
  })

  it('omits a zero-value tender line for a fully loyalty-funded sale', () => {
    const lines = buildPosSaleLines({
      total: 0,
      subtotal: 1000,
      tax: 0,
      pointsRedeemed: 1000,
      orderRef: 'POS0000',
      paymentMethod: 'mpesa',
    })
    const resolved = lines.map(l => ({
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      account: resolvePostingAccountLabel(l),
    }))
    expect(() => assertPostingBalanced(resolved)).not.toThrow()
    expect(resolved.some(l => l.account === '2211 - Petty Cash / Mobile Money')).toBe(false)
    expect(resolved.some(l => l.account === '5200 - Sales Discounts')).toBe(true)
  })

  it('builds balanced POS sale with VAT and loyalty', () => {
    const lines = buildPosSaleLines({
      total: 1000,
      subtotal: 1000,
      tax: 160,
      pointsRedeemed: 160,
      orderRef: 'POS0001',
      paymentMethod: 'mpesa',
    })
    const resolved = lines.map(l => ({
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      account: resolvePostingAccountLabel(l),
    }))
    expect(() => assertPostingBalanced(resolved)).not.toThrow()
    expect(resolved.some(l => l.account === '2211 - Petty Cash / Mobile Money')).toBe(true)
    expect(resolved.some(l => l.account === '3301 - Output VAT Payable')).toBe(true)
    expect(resolved.some(l => l.account === '5200 - Sales Discounts')).toBe(true)
  })
})

describe('expense / POS post helpers', () => {
  it('posts expense approval via MISC journal', async () => {
    await postExpenseApproval({
      expenseId: 'exp-1',
      ref: 'EXP-1',
      description: 'Water',
      amount: 400,
      category: 'water',
      paymentMethod: 'reimbursement',
      submittedByName: 'Ada',
    })
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'JRN/EXP/EXP-1',
        source: 'expense',
      }),
      expect.objectContaining({ journalCode: 'MISC' }),
    )
  })

  it('posts expense reimbursement via MISC journal', async () => {
    await postExpenseReimbursement({
      expenseId: 'exp-1',
      ref: 'EXP-1',
      amount: 400,
      bankAccountId: 'ncba',
    })
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'JRN/RIM/EXP-1', source: 'expense' }),
      expect.objectContaining({ journalCode: 'MISC' }),
    )
  })

  it('posts POS sale via BNK journal', async () => {
    await postPosSale({
      orderId: 'pos-1',
      orderRef: 'POS0002',
      total: 1160,
      subtotal: 1000,
      tax: 160,
      paymentMethod: 'mpesa',
      customerName: 'Walk-in',
    })
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'JRN/POS0002',
        source: 'pos',
      }),
      expect.objectContaining({ journalCode: 'BNK' }),
    )
  })
})
