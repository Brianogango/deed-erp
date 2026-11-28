import { describe, expect, it } from 'vitest'
import { exchangeDocumentView, exchangeRefOf, invoiceExchangeView } from '@/lib/after-sales/exchange-document'

const exc = {
  id: 'e1', ref: 'EXC/2026/0005', customerName: 'Enock Kiprop', originalSORef: 'SO/2026/0412', status: 'completed',
  returnLines: [{ productName: 'HP EliteBook 840 G5', qty: 1, serialIds: ['s-old'], unitPrice: 34000 }],
  newLines: [{ productName: 'HP EliteBook 840 G6', qty: 1, serialIds: ['s-new'], unitPrice: 40000 }],
  returnTotal: 34000, newTotal: 40000, priceDiff: 6000,
}
const serials = [
  { id: 's-old', serial: '5CG8411A1', specs: 'i5, 8GB RAM, 256GB SSD' },
  { id: 's-new', serial: '5CG9233KQ1', specs: 'i5, 16GB RAM, 512GB SSD' },
]
const invoice = {
  notes: 'From exchange EXC/2026/0005 · completed by Edwin',
  subtotal: 6000, total: 6000,
  lines: [{ description: 'Exchange EXC/2026/0005 — balance after returning KSh 34,000 of goods for KSh 40,000' }],
}

describe('exchange documents', () => {
  it('finds the exchange an invoice was raised for', () => {
    expect(exchangeRefOf(invoice)).toBe('EXC/2026/0005')
    expect(exchangeRefOf({ notes: 'From exchange EXC/2026/0009', lines: [{ description: 'Laptop' }] })).toBe('EXC/2026/0009')
    expect(exchangeRefOf({ notes: '', lines: [{ description: 'HP EliteBook, see EXC/2026/0001' }] })).toBeNull()
  })

  it('lists both machines with serials and specs, and ± rows that add up to the balance', () => {
    const v = exchangeDocumentView(exc, serials)
    expect(v.returned).toEqual([{ productName: 'HP EliteBook 840 G5', specs: 'i5, 8GB RAM, 256GB SSD', serial: '5CG8411A1', qty: 1, amount: 34000 }])
    expect(v.given[0].serial).toBe('5CG9233KQ1')
    expect(v.rows.map(r => [r.kind, r.subtotal])).toEqual([['given', 40000], ['returned', -34000]])
    expect(v.rows[1].description).toBe('Returned: HP EliteBook 840 G5 — i5, 8GB RAM, 256GB SSD')
    expect(v.balance).toBe(6000)
  })

  it('stands in for the single balance line only when the amounts agree', () => {
    expect(invoiceExchangeView(invoice, [exc], serials)?.replacesLines).toBe(true)
    // Edited since (another line, or a different amount): summary only.
    expect(invoiceExchangeView({ ...invoice, subtotal: 5000 }, [exc], serials)?.replacesLines).toBe(false)
    expect(invoiceExchangeView({ ...invoice, lines: [...invoice.lines, { description: 'Bag' }] }, [exc], serials)?.replacesLines).toBe(false)
    expect(invoiceExchangeView(invoice, [], serials)).toBeNull()
  })

  it('a bulk line stays one row; an upgraded machine shows its unit name', () => {
    const v = exchangeDocumentView({
      ...exc,
      returnLines: [{ productName: 'Mouse', qty: 2, serialIds: [], unitPrice: 500 }],
    }, [{ id: 's-new', serial: '5CG9233KQ1', unitName: 'HP EliteBook 840 G6 - i5, 32GB RAM' }])
    expect(v.returned).toEqual([{ productName: 'Mouse', qty: 2, amount: 1000 }])
    expect(v.given[0].productName).toBe('HP EliteBook 840 G6 - i5, 32GB RAM')
  })
})
