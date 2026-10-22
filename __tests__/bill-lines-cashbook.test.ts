import { describe, expect, it } from 'vitest'
import { splitBillAmount, unmatchedSaleLines } from '@/lib/accounting/sales-lines'

const names: Record<string, string> = { '5001': 'Laptops', '5003': 'Desktops', '6401': 'Rent', '6410': 'Internet', '6101': 'Purchases' }
const known = (c: string) => c in names
const name = (c: string) => names[c]
const none = new Map()

describe('what a supplier payment paid for', () => {
  it('stock shows its product line, overheads their expense account', () => {
    const parts = splitBillAmount(60000, [
      { description: 'HP EliteBook 840 G5', qty: 1, unitPrice: 40000 },
      { description: 'Office rent October', qty: 1, unitPrice: 20000, accountCode: '6401' },
    ], none, known, name)
    expect(parts).toEqual([
      { key: 'line:5001', name: 'Laptops', amount: 40000 },
      { key: 'acct:6401', name: 'Rent', amount: 20000 },
    ])
  })

  it('a part payment is split in proportion', () => {
    const parts = splitBillAmount(1000, [
      { description: 'Dell OptiPlex 7010', qty: 3, unitPrice: 30000 },
      { description: 'Lenovo ThinkPad T480', qty: 1, unitPrice: 30000 },
    ], none, known, name)
    expect(parts.map(p => [p.name, p.amount])).toEqual([['Desktops', 750], ['Laptops', 250]])
  })

  it('unrecognised lines fall back to their account, then "Other purchases"', () => {
    expect(splitBillAmount(500, [{ description: 'Assorted items', qty: 1, unitPrice: 500, accountCode: '6101' }], none, known, name)[0].name).toBe('Purchases')
    expect(splitBillAmount(500, [{ description: 'Assorted items', qty: 1, unitPrice: 500 }], none, known, name)[0].name).toBe('Other purchases')
  })

  it('a bill without lines is a plain supplier payment', () => {
    expect(splitBillAmount(500, [], none, known, name)).toEqual([{ key: 'purchases', name: 'Supplier payment', amount: 500 }])
  })
})

describe('other sales', () => {
  it('lists the hand-typed lines no product line matched', () => {
    expect(unmatchedSaleLines([
      { description: 'HP EliteBook 840 G5', qty: 1, unitPrice: 40000 },
      { description: 'Delivery to Kisumu', qty: 1, unitPrice: 4400 },
    ], none, known)).toEqual(['Delivery to Kisumu'])
  })
})
