import { describe, expect, it } from 'vitest'
import { CUSTOMER_CREDITS_ACCOUNT, CUSTOMER_CREDITS_CODE } from '@/lib/accounting/liability-accounts'
import {
  BUYBACK_STORE_CREDIT_METHOD,
  TRADE_IN_PURCHASES_ACCOUNT,
  TRADE_IN_PURCHASES_CODE,
  buildBuyBackStoreCreditJournalLines,
  canCreditBuyBack,
  canPayBuyBackCash,
  canSettleApprovedBuyBack,
  isBuyBackStoreCredit,
} from '@/lib/buyback-credit'

const approved = { status: 'approved' as const, total: 25000 }

describe('buy-back settlement: pay or add as credit', () => {
  it('allows either cash payout or store credit only after approve', () => {
    expect(canSettleApprovedBuyBack({ status: 'draft', total: 25000 }).ok).toBe(false)
    expect(canSettleApprovedBuyBack(approved).ok).toBe(true)
    expect(canPayBuyBackCash(approved, 'mpesa').ok).toBe(true)
    expect(canCreditBuyBack(approved).ok).toBe(true)
  })

  it('rejects a second settlement after pay or credit', () => {
    expect(canSettleApprovedBuyBack({ status: 'paid', paymentMethod: 'cash', total: 25000 }).ok).toBe(false)
    expect(canPayBuyBackCash({ status: 'paid', paymentMethod: BUYBACK_STORE_CREDIT_METHOD, total: 25000 }, 'cash').ok).toBe(false)
    expect(canCreditBuyBack({ status: 'approved', creditId: 'c1', total: 25000 }).ok).toBe(false)
    expect(canCreditBuyBack({ status: 'stocked', paymentMethod: 'mpesa', total: 25000 }).ok).toBe(false)
  })

  it('does not let Record Payment take the store-credit method', () => {
    const blocked = canPayBuyBackCash(approved, BUYBACK_STORE_CREDIT_METHOD)
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toMatch(/Add as credit/i)
  })

  it('does not issue store credit for a zero buy-back', () => {
    expect(canCreditBuyBack({ status: 'approved', total: 0 }).ok).toBe(false)
  })

  it('credits 3313 and does not touch petty cash', () => {
    const lines = buildBuyBackStoreCreditJournalLines({
      buyBackRef: 'BBK/0001',
      creditRef: 'CN/2026/0009',
      customerName: 'Jane',
      amount: 25000,
    })
    expect(lines).toHaveLength(2)
    expect(lines[0]?.account).toBe(TRADE_IN_PURCHASES_ACCOUNT)
    expect(lines[0]?.debit).toBe(25000)
    expect(lines[1]?.account).toBe(CUSTOMER_CREDITS_ACCOUNT)
    expect(lines[1]?.credit).toBe(25000)
    expect(lines.some(l => l.account.includes('2211'))).toBe(false)
    expect(CUSTOMER_CREDITS_CODE).toBe('3313')
    expect(TRADE_IN_PURCHASES_CODE).toBe('6114')
    expect(isBuyBackStoreCredit({ paymentMethod: BUYBACK_STORE_CREDIT_METHOD })).toBe(true)
  })
})
