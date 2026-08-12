import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertPostingBalanced,
  buildCustomerInvoiceLines,
  buildInvoicePaymentLines,
  commitPosting,
  invoiceResidual,
  resolvePostingAccountLabel,
  roundMoney,
} from '@/lib/accounting/posting-service'
import { isAccountingPostingEngineEnabled } from '@/lib/accounting/posting-flag'
import { COA_ROLE_CODES, labelForRole } from '@/lib/accounting/coa-roles'

const { mockPersist } = vi.hoisted(() => ({
  mockPersist: vi.fn(),
}))

vi.mock('@/lib/accounting/journal-service', () => ({
  persistStoreJournalEntry: mockPersist,
  reverseJournalEntry: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockPersist.mockResolvedValue({ id: 'je-1', ref: 'JRN/INV-1' })
  delete process.env.ACCOUNTING_POSTING_ENGINE
})

describe('CoA role map', () => {
  it('keeps live production codes stable', () => {
    expect(COA_ROLE_CODES.ar).toBe('1800')
    expect(COA_ROLE_CODES.ap).toBe('3000')
    expect(COA_ROLE_CODES.grni).toBe('3201')
    expect(COA_ROLE_CODES.output_vat).toBe('3301')
    expect(COA_ROLE_CODES.input_vat).toBe('1150')
    expect(labelForRole('ar')).toBe('1800 - Accounts Receivable')
    expect(labelForRole('customer_deposits')).toBe('3100 - Customer Deposits')
    expect(labelForRole('input_vat')).toBe('1150 - VAT Input')
  })
})

describe('posting flag', () => {
  it('defaults off', () => {
    expect(isAccountingPostingEngineEnabled()).toBe(false)
  })

  it('enables for true/1/on/yes', () => {
    for (const v of ['true', '1', 'on', 'yes', 'TRUE']) {
      process.env.ACCOUNTING_POSTING_ENGINE = v
      expect(isAccountingPostingEngineEnabled()).toBe(true)
    }
  })
})

describe('residual helper', () => {
  it('computes invoice residual after allocations', () => {
    expect(invoiceResidual(10000, 2500.5)).toBe(7499.5)
    expect(roundMoney(50.555)).toBe(50.56)
  })
})

describe('line builders', () => {
  it('builds a balanced customer invoice with VAT', () => {
    const lines = buildCustomerInvoiceLines({
      partnerName: 'Acme',
      ref: 'INV-9',
      total: 1160,
      subtotal: 1000,
      tax: 160,
      revenueAccountLabel: '5000',
    })
    const resolved = lines.map(l => ({
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      account: resolvePostingAccountLabel(l),
    }))
    expect(() => assertPostingBalanced(resolved, 'JRN/INV-9')).not.toThrow()
    expect(resolved[0].account).toBe('1800 - Accounts Receivable')
    expect(resolved.some(l => l.account === '3301 - Output VAT Payable')).toBe(true)
  })

  it('rejects unbalanced postings', () => {
    expect(() => assertPostingBalanced([
      { debit: 100, credit: 0 },
      { debit: 0, credit: 50 },
    ], 'JRN/BAD')).toThrow(/Unbalanced posting/)
  })

  it('builds customer receipt and credit-apply payment lines', () => {
    const cash = buildInvoicePaymentLines({
      partnerName: 'Acme',
      ref: 'INV-1',
      amount: 500,
      method: 'mpesa',
    })
    expect(resolvePostingAccountLabel(cash[0])).toBe('2211 - Petty Cash / Mobile Money')
    expect(resolvePostingAccountLabel(cash[1])).toBe('1800 - Accounts Receivable')

    const credit = buildInvoicePaymentLines({
      partnerName: 'Acme',
      ref: 'INV-1',
      amount: 200,
      method: 'customer_credit',
    })
    expect(resolvePostingAccountLabel(credit[0])).toBe('3102 - Customer Credits')
  })
})

describe('commitPosting', () => {
  it('persists balanced lines via journal-service', async () => {
    await commitPosting({
      ref: 'JRN/INV-1',
      source: 'invoice',
      description: 'Invoice INV-1',
      invoiceId: 'inv-1',
      journalCode: 'SAL',
      lines: buildCustomerInvoiceLines({
        partnerName: 'Acme',
        ref: 'INV-1',
        total: 100,
        subtotal: 100,
        tax: 0,
        revenueAccountLabel: '5000',
      }),
    })
    expect(mockPersist).toHaveBeenCalledTimes(1)
    const arg = mockPersist.mock.calls[0][0]
    expect(arg.ref).toBe('JRN/INV-1')
    expect(arg.lines).toEqual([
      { account: '1800 - Accounts Receivable', description: 'AR: Acme', debit: 100, credit: 0 },
      { account: '5000', description: 'Revenue: INV-1', debit: 0, credit: 100 },
    ])
  })

  it('does not persist when lines are unbalanced', async () => {
    await expect(commitPosting({
      ref: 'JRN/BAD',
      source: 'manual',
      description: 'bad',
      lines: [
        { role: 'ar', description: 'x', debit: 10, credit: 0 },
        { role: 'ap', description: 'y', debit: 0, credit: 5 },
      ],
    })).rejects.toThrow(/Unbalanced/)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('posts vendor bill lines through commitPosting (PUR)', async () => {
    const { postVendorBill } = await import('@/lib/accounting/posting-service')
    await postVendorBill({
      invoiceId: 'bill-1',
      ref: 'BILL/1',
      partnerName: 'Vendor Co',
      lines: [
        { account: '3201 - Accruals', description: 'Clear GRNI', debit: 1000, credit: 0 },
        { account: '3000 - Accounts Payable', description: 'AP', debit: 0, credit: 1000 },
      ],
    })
    expect(mockPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'JRN/BILL/1',
        source: 'bill',
      }),
      expect.objectContaining({ journalCode: 'PUR' }),
    )
  })
})
