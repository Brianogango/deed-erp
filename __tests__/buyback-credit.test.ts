import { describe, expect, it } from 'vitest'
import { BUYBACK_STORE_CREDIT_METHOD, canCreditBuyBack, canPayBuyBackCash, canSettleApprovedBuyBack } from '@/lib/buyback-credit'

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

  })

import { canReceiveFreeBuyBack } from '@/lib/buyback-credit'

describe('a device given for free (KSh 0 buy-back)', () => {
  it('is received at no cost once approved — not paid or credited', () => {
    expect(canReceiveFreeBuyBack({ status: 'approved', total: 0 }).ok).toBe(true)
    expect(canPayBuyBackCash({ status: 'approved', total: 0 }, 'cash').ok).toBe(false)
    expect(canCreditBuyBack({ status: 'approved', total: 0 }).ok).toBe(false)
  })
  it('a buy-back with an amount, or not yet approved, is not', () => {
    expect(canReceiveFreeBuyBack({ status: 'approved', total: 500 }).ok).toBe(false)
    expect(canReceiveFreeBuyBack({ status: 'draft', total: 0 }).ok).toBe(false)
    expect(canReceiveFreeBuyBack({ status: 'paid', total: 0 }).ok).toBe(false)
  })
})
