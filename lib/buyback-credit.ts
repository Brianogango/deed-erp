/**
 * After a buy-back is approved, settle it exactly once:
 * pay cash/M-Pesa/bank, or add the same amount as store credit (3313).
 * Never both. Stocking still happens after either settlement.
 */

import { CUSTOMER_CREDITS_ACCOUNT } from '@/lib/accounting/liability-accounts'

const BUYBACK_CASH_METHODS = ['cash', 'mpesa', 'bank_transfer'] as const
type BuyBackCashMethod = (typeof BUYBACK_CASH_METHODS)[number]
export const BUYBACK_STORE_CREDIT_METHOD = 'store_credit' as const
/** Expense counterpart when the payout is store credit instead of cash. */
export const TRADE_IN_PURCHASES_CODE = '6114'
export const TRADE_IN_PURCHASES_ACCOUNT = '6114 - Trade-in Purchases'

type BuyBackSettleLike = {
  status?: string
  total?: number
  paymentMethod?: string | null
  creditId?: string | null
}

function isBuyBackCashMethod(method?: string | null): method is BuyBackCashMethod {
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

type BuyBackLineLike = { productId: string; productName: string; qty: number; unitPrice: number; condition?: string; serialIds?: string[] }

/**
 * A cash / M-Pesa / bank payout is a purchase from the customer: a vendor
 * bill to them, booked to Trade-in Purchases (6114), posted and paid from the
 * till. It used to record only a refund-list row, so the payout never reached
 * the books.
 */
export function buildBuyBackPayoutBillLines(
  bb: { ref: string; lines: BuyBackLineLike[] },
  serialNumberOf: (serialId: string) => string = id => id,
): Array<{ description: string; qty: number; unitPrice: number; taxRate: number; subtotal: number; productId: string; accountCode: string }> {
  return bb.lines
    .filter(l => Number(l.qty) > 0)
    .map(l => {
      const serials = (l.serialIds ?? []).map(serialNumberOf).filter(Boolean)
      const qty = Number(l.qty)
      const unitPrice = Math.max(0, Number(l.unitPrice) || 0)
      return {
        description: `Trade-in ${bb.ref}: ${l.productName}${l.condition ? ` (${l.condition})` : ''}${serials.length ? ` — S/N ${serials.join(', ')}` : ''}`,
        qty,
        unitPrice,
        taxRate: 0,
        subtotal: qty * unitPrice,
        productId: l.productId,
        accountCode: TRADE_IN_PURCHASES_CODE,
      }
    })
}

/**
 * What a stocked buy-back adds to inventory value: per product, the units and
 * their trade-in cost (several lines of one product are combined — the
 * valuation records one entry per buy-back and product). The cost comes out
 * of Trade-in Purchases (6114) into Inventory, so a machine resold later
 * carries what we paid for it instead of zero.
 */
export function buyBackStockCosts(lines: BuyBackLineLike[]): Array<{ productId: string; qty: number; unitCost: number }> {
  const byProduct = new Map<string, { qty: number; value: number }>()
  for (const l of lines) {
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0))
    if (!l.productId || qty <= 0) continue
    const row = byProduct.get(l.productId) ?? { qty: 0, value: 0 }
    row.qty += qty
    row.value += qty * Math.max(0, Number(l.unitPrice) || 0)
    byProduct.set(l.productId, row)
  }
  return [...byProduct.entries()].map(([productId, r]) => ({ productId, qty: r.qty, unitCost: Math.round((r.value / r.qty) * 100) / 100 }))
}

const sameName = (a: unknown, b: unknown) =>
  String(a ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The product a buy-back line is for. When its product id is gone (a product
 * that never reached the products table, or one merged away) and exactly one
 * active product has the line's name, that is the product — the line is
 * relinked to it. Anything less certain stays unresolved for a person.
 */
export function resolveBuyBackProduct<P extends { id: string; name?: string; isActive?: boolean; mergedIntoId?: string }>(
  line: { productId: string; productName: string },
  products: P[],
): P | undefined {
  const direct = products.find(p => p.id === line.productId)
  if (direct?.mergedIntoId) return products.find(p => p.id === direct.mergedIntoId) ?? direct
  if (direct) return direct
  const named = products.filter(p => p.isActive !== false && sameName(p.name, line.productName))
  return named.length === 1 ? named[0] : undefined
}

/**
 * Buy-backs paid out in cash / M-Pesa / bank before payouts made a bill: the
 * money left but no journal booked it. Listed for the accountant, not posted.
 */
export function buyBacksPaidWithoutBill<T extends { status: string; paymentMethod?: string; billId?: string; creditId?: string }>(list: T[]): T[] {
  return list.filter(b =>
    (b.status === 'paid' || b.status === 'stocked')
    && !!b.paymentMethod && b.paymentMethod !== 'store_credit'
    && !b.billId && !b.creditId)
}
