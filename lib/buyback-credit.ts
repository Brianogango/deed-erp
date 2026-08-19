/**
 * After a buy-back is approved, settle it exactly once:
 * pay cash/M-Pesa/bank, or add the same amount as store credit (3102).
 * Never both. Stocking still happens after either settlement.
 */

import { CUSTOMER_CREDITS_ACCOUNT } from '@/lib/accounting/liability-accounts'

export const BUYBACK_CASH_METHODS = ['cash', 'mpesa', 'bank_transfer'] as const
export type BuyBackCashMethod = (typeof BUYBACK_CASH_METHODS)[number]
export const BUYBACK_STORE_CREDIT_METHOD = 'store_credit' as const
export type BuyBackPayoutMethod = BuyBackCashMethod | typeof BUYBACK_STORE_CREDIT_METHOD

/** Expense counterpart when the payout is store credit instead of cash. */
export const TRADE_IN_PURCHASES_CODE = '6108'
export const TRADE_IN_PURCHASES_ACCOUNT = '6108 - Trade-in Purchases'

export type BuyBackSettleLike = {
  status?: string
  total?: number
  paymentMethod?: string | null
  creditId?: string | null
}

export function isBuyBackCashMethod(method?: string | null): method is BuyBackCashMethod {
  return BUYBACK_CASH_METHODS.includes(method as BuyBackCashMethod)
}

export function isBuyBackStoreCredit(bb: BuyBackSettleLike): boolean {
  return bb.paymentMethod === BUYBACK_STORE_CREDIT_METHOD
}

export function canSettleApprovedBuyBack(bb: BuyBackSettleLike | null | undefined): {
  ok: boolean
  error?: string
} {
  if (!bb) return { ok: false, error: 'Buy-back not found' }
  // `paid` covers both cash payout and store credit; `creditId` catches a partial write.
  if (bb.status === 'paid' || bb.status === 'stocked' || bb.creditId) {
    return { ok: false, error: 'This buy-back is already settled' }
  }
  if (bb.status !== 'approved') {
    return { ok: false, error: 'Approve the buy-back before settling' }
  }
  return { ok: true }
}

/** Record Payment — cash/M-Pesa/bank only. `store_credit` must use Add as credit. */
export function canPayBuyBackCash(
  bb: BuyBackSettleLike | null | undefined,
  method?: string | null,
): { ok: boolean; error?: string } {
  const settle = canSettleApprovedBuyBack(bb)
  if (!settle.ok) return settle
  if (method === BUYBACK_STORE_CREDIT_METHOD) {
    return { ok: false, error: 'Use Add as credit — do not record a cash payout' }
  }
  if (!isBuyBackCashMethod(method)) {
    return { ok: false, error: 'Choose cash, M-Pesa, or bank transfer' }
  }
  return { ok: true }
}

/** Add as credit — same total onto 3102. Zero-value BBKs have nothing to credit. */
export function canCreditBuyBack(bb: BuyBackSettleLike | null | undefined): {
  ok: boolean
  error?: string
} {
  const settle = canSettleApprovedBuyBack(bb)
  if (!settle.ok) return settle
  const amount = Math.round(Number(bb?.total) || 0)
  if (amount <= 0) {
    return { ok: false, error: 'Store credit needs a buy-back amount greater than zero' }
  }
  return { ok: true }
}

export function buyBackStoreCreditAmount(bb: { total?: number }): number {
  return Math.max(0, Math.round(Number(bb.total) || 0))
}

export function buildBuyBackStoreCreditJournalLines(opts: {
  buyBackRef: string
  creditRef: string
  customerName: string
  amount: number
}): { account: string; description: string; debit: number; credit: number }[] {
  const amount = Math.round(Number(opts.amount) || 0)
  // Do not touch 2211 Petty Cash — this settlement is not a till payout.
  return [
    {
      account: TRADE_IN_PURCHASES_ACCOUNT,
      description: `Trade-in ${opts.buyBackRef} settled as credit ${opts.creditRef}`,
      debit: amount,
      credit: 0,
    },
    {
      account: CUSTOMER_CREDITS_ACCOUNT,
      description: `Store credit ${opts.creditRef}: ${opts.customerName}`,
      debit: 0,
      credit: amount,
    },
  ]
}
