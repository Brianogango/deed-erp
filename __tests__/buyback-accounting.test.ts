import { describe, expect, it } from 'vitest'
import { buildBuyBackPayoutBillLines, buyBackStockCosts, TRADE_IN_PURCHASES_CODE } from '@/lib/buyback-credit'

const bb = {
  ref: 'BBK/2026/0009',
  lines: [
    { productId: 'x380', productName: 'Lenovo Thinkpad X380 Yoga', qty: 1, unitPrice: 3000, condition: 'poor', serialIds: ['s1'] },
    { productId: 'x380', productName: 'Lenovo Thinkpad X380 Yoga', qty: 2, unitPrice: 4500, condition: 'good', serialIds: ['s2', 's3'] },
    { productId: 'chg', productName: 'Charger', qty: 1, unitPrice: 0 },
  ],
}

describe('buy-back accounting', () => {
  it('the payout bill books every line to Trade-in Purchases, with the serials', () => {
    const lines = buildBuyBackPayoutBillLines(bb, id => ({ s1: 'PF1', s2: 'PF2', s3: 'PF3' } as Record<string, string>)[id])
    expect(lines.map(l => l.accountCode)).toEqual([TRADE_IN_PURCHASES_CODE, TRADE_IN_PURCHASES_CODE, TRADE_IN_PURCHASES_CODE])
    expect(lines[0]).toMatchObject({ qty: 1, unitPrice: 3000, subtotal: 3000, taxRate: 0 })
    expect(lines[0].description).toBe('Trade-in BBK/2026/0009: Lenovo Thinkpad X380 Yoga (poor) — S/N PF1')
    expect(lines.reduce((s, l) => s + l.subtotal, 0)).toBe(12000)
  })

  it('stocking adds each product once, at its average trade-in cost', () => {
    expect(buyBackStockCosts(bb.lines)).toEqual([
      { productId: 'x380', qty: 3, unitCost: 4000 },
      { productId: 'chg', qty: 1, unitCost: 0 },
    ])
  })
})

import { resolveBuyBackProduct } from '@/lib/buyback-credit'
describe('buy-back product', () => {
  const products = [
    { id: 'a', name: 'Lenovo Thinkpad X380 Yoga - Intel Core i5(8th Gen) 8GB RAM - 256GB SSD - 13" X360', isActive: true },
    { id: 'old', name: 'Old X1', isActive: false, mergedIntoId: 'b' },
    { id: 'b', name: 'X1 Carbon', isActive: true },
    { id: 'd1', name: 'Dup', isActive: true }, { id: 'd2', name: 'Dup', isActive: true },
  ]
  it('finds it by id, follows a merge, or by its exact name when the id is gone', () => {
    expect(resolveBuyBackProduct({ productId: 'a', productName: '' }, products)?.id).toBe('a')
    expect(resolveBuyBackProduct({ productId: 'old', productName: 'Old X1' }, products)?.id).toBe('b')
    expect(resolveBuyBackProduct({ productId: 'gone', productName: 'Lenovo Thinkpad X380 Yoga - Intel Core i5(8th Gen) 8GB RAM - 256GB SSD - 13"  X360' }, products)?.id).toBe('a')
  })
  it('never guesses between two products of the same name', () => {
    expect(resolveBuyBackProduct({ productId: 'gone', productName: 'Dup' }, products)).toBeUndefined()
  })
})

describe('buy-back payouts never booked', () => {
  it('lists cash / M-Pesa / bank payouts with no bill', async () => {
    const { buyBacksPaidWithoutBill } = await import('@/lib/buyback-credit')
    const list = [
      { id: 'a', status: 'paid', paymentMethod: 'cash' },
      { id: 'b', status: 'stocked', paymentMethod: 'mpesa', billId: 'x' },
      { id: 'c', status: 'paid', paymentMethod: 'store_credit', creditId: 'c1' },
      { id: 'd', status: 'stocked', paymentMethod: 'bank_transfer' },
      { id: 'e', status: 'approved' },
    ]
    expect(buyBacksPaidWithoutBill(list).map(b => b.id)).toEqual(['a', 'd'])
  })
})
