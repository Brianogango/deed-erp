import { describe, expect, it } from 'vitest'
import {
  donationAccount,
  donationOutJournalLines,
  marketplaceFeeAccount,
  marketplaceSettlementJournalLines,
  exchangeSettlement,
  exchangeCreditJournalLines,
} from '@/lib/after-sales/value-journals'

const balanced = (lines: Array<{ debit: number; credit: number }>) => {
  const d = lines.reduce((t, l) => t + l.debit, 0)
  const c = lines.reduce((t, l) => t + l.credit, 0)
  return Math.round((d - c) * 100) / 100
}

describe('donation out', () => {
  it('moves the value from inventory to the donations expense, at cost', () => {
    const lines = donationOutJournalLines({
      donationRef: 'DON/12', party: 'Nairobi Primary',
      expenseAccount: '6514 - Gifts and Donations',
      lines: [{ productName: 'Laptop', qty: 2, unitCost: 18000 }],
    })
    expect(balanced(lines)).toBe(0)
    expect(lines.find(l => l.debit > 0)?.account).toBe('6514 - Gifts and Donations')
    expect(lines.find(l => l.credit > 0)?.account).toBe('1200 - Inventory')
    expect(lines.find(l => l.debit > 0)?.debit).toBe(36000)
  })

  it('writes nothing for a line with no cost, rather than a zero entry', () => {
    expect(donationOutJournalLines({
      donationRef: 'DON/13', party: 'X', expenseAccount: '6514 - Gifts and Donations',
      lines: [{ productName: 'Cable', qty: 5, unitCost: 0 }],
    })).toEqual([])
  })

  it('falls back when the tenant has no donations account', () => {
    expect(donationAccount(['6514', '1200']).code).toBe('6514')
    expect(donationAccount(['1200']).code).toBe('6599')
  })
})

describe('marketplace settlement', () => {
  const settlement = {
    settlementRef: 'KSET/4', period: '1–7 Apr 2026',
    gross: 100000, deductions: 12000, netPaid: 88000,
    bankAccount: '2211 - Petty Cash / Mobile Money',
    feeAccount: '6401 - Selling and Delivery',
  }

  it('banks the net, expenses the cut, clears the whole receivable', () => {
    const lines = marketplaceSettlementJournalLines(settlement)
    expect(balanced(lines)).toBe(0)
    expect(lines.find(l => l.account === settlement.bankAccount)?.debit).toBe(88000)
    expect(lines.find(l => l.account === settlement.feeAccount)?.debit).toBe(12000)
    expect(lines.find(l => l.credit > 0)?.credit).toBe(100000)
  })

  it('leaves out the fee line when they kept nothing', () => {
    const lines = marketplaceSettlementJournalLines({ ...settlement, deductions: 0, netPaid: 100000 })
    expect(lines).toHaveLength(2)
    expect(balanced(lines)).toBe(0)
  })

  it('posts nothing for an empty settlement', () => {
    expect(marketplaceSettlementJournalLines({ ...settlement, gross: 0, deductions: 0, netPaid: 0 })).toEqual([])
  })
})

describe('exchange balance', () => {
  it('reads which way the money goes', () => {
    expect(exchangeSettlement(2500)).toEqual({ owed: 'customer', amount: 2500 })
    expect(exchangeSettlement(-2500)).toEqual({ owed: 'us', amount: 2500 })
    expect(exchangeSettlement(0)).toEqual({ owed: 'nobody', amount: 0 })
  })

  it('books what we owe as store credit against sales returns', () => {
    const lines = exchangeCreditJournalLines({
      exchangeRef: 'EXC/7', creditRef: 'CR/EXC/7', customerName: 'Achieng', amount: 2500,
    })
    expect(balanced(lines)).toBe(0)
    expect(lines.find(l => l.debit > 0)?.account).toBe('5099 - Sales Returns & Refunds')
    expect(lines.find(l => l.credit > 0)?.account).toBe('3313 - Customer Credits')
  })

  it('writes no credit entry for an even exchange', () => {
    expect(exchangeCreditJournalLines({ exchangeRef: 'EXC/8', creditRef: 'CR/EXC/8', customerName: 'A', amount: 0 })).toEqual([])
  })

  it('picks a marketplace fee account the tenant has', () => {
    expect(marketplaceFeeAccount(['6401', '1200']).code).toBe('6401')
    expect(marketplaceFeeAccount(['6403', '6401']).code).toBe('6403')
    expect(marketplaceFeeAccount(['1200']).code).toBe('6599')
  })
})
