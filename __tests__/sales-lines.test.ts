import { describe, expect, it } from 'vitest'
import { saleLineCode, salesCodeFromText, splitSaleAmount } from '@/lib/accounting/sales-lines'

const cases: Array<[string, string | undefined]> = [
  ['HP EliteBook 840 G5 Core i5 8GB RAM 256GB SSD', '5001'],
  ['Lenovo ThinkPad T480', '5001'],
  ['Laptop Core i7 16GB', '5001'],
  ['Dell OptiPlex 7070 SFF i5 8GB 256 SSD', '5003'],
  ['HP ProDesk 600 G3 + 22" monitor combo', '5003'],
  ['Desktop tower Core i5', '5003'],
  ['Dell 24 inch monitor P2419H', '5004'],
  ['HP laptop charger 65W', '5002'],
  ['Wireless mouse', '5002'],
  ['Laptop bag', '5002'],
  ['Samsung 500GB SSD', '5006'],
  ['8GB DDR4 RAM', '5010'],
  ['Laptop battery HP 840 G5', '5010'],
  ['Screen repair', '5121'],
  ['Diagnosis fee', '5121'],
  ['Windows installation', '5122'],
  ['Windows 11 Pro licence', '5009'],
  ['HP 85A toner', '5011'],
  ['HP LaserJet Pro M404dn printer', '5008'],
  ['APC 650VA UPS', '5007'],
  ['TP-Link router', '5012'],
  ['Dell PowerEdge R740 server', '5005'],
  ['Data recovery', '5107'],
  ['Consultancy', undefined],
]

describe('product line from a hand-typed description', () => {
  it.each(cases)('%s', (text, code) => {
    expect(salesCodeFromText(text)).toBe(code)
  })
})

describe('line account', () => {
  const known = () => true
  it('a product with its own sales account wins', () => {
    expect(saleLineCode({ productId: 'p', description: 'Mouse' }, { category: 'Laptops' } as never, known)).toBe('5001')
  })
  it('a line typed by hand is read from its description', () => {
    expect(saleLineCode({ description: 'HP EliteBook 840 G5' }, undefined, known)).toBe('5001')
  })
  it('nothing recognisable stays on general sales', () => {
    expect(saleLineCode({ description: 'Consultancy' }, undefined, known)).toBe('5000')
  })
  it('only accounts that exist in the chart are used', () => {
    expect(saleLineCode({ description: 'HP EliteBook 840 G5' }, undefined, c => c !== '5001')).toBe('5000')
  })
})

describe('splitting a receipt between product lines', () => {
  it('in proportion to line value, to the cent', () => {
    const parts = splitSaleAmount(10000, [
      { description: 'HP EliteBook 840 G5', subtotal: 30000 },
      { description: 'Laptop bag', subtotal: 10000 },
    ], new Map(), () => true)
    expect(parts).toEqual([{ code: '5001', amount: 7500 }, { code: '5002', amount: 2500 }])
  })
  it('a sale with no usable lines is general sales', () => {
    expect(splitSaleAmount(500, [], new Map(), () => true)).toEqual([{ code: '5000', amount: 500 }])
  })
  it('POS lines use qty × price', () => {
    expect(splitSaleAmount(2000, [{ productName: 'Wireless mouse', qty: 2, price: 1000 }], new Map(), () => true))
      .toEqual([{ code: '5002', amount: 2000 }])
  })
})
