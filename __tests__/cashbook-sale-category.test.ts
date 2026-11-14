import { describe, expect, it } from 'vitest'
import { buildCashbookEntries } from '@/components/modules/Cashbook'

const accounts = [
  { code: '5001', name: 'Laptops' },
  { code: '5002', name: 'Accessories' },
  { code: '5003', name: 'Desktop / Combo' },
  { code: '5008', name: 'Printers' },
  { code: '5000', name: 'Sales Revenue' },
]
const products = [
  { id: 'lap', category: 'Laptops' },
  { id: 'acc', category: 'Accessories' },
  { id: 'prn', category: 'Printers' },
]

describe('sale category in the Cashbook', () => {
  
  
  
  it('labels invoice payments, POS sales and deposits correctly in the cashbook', () => {
    const entries = buildCashbookEntries({
      invoices: [{
        id: 'i1', type: 'customer_invoice', ref: 'INV/1', partnerName: 'A',
        lines: [{ id: 'l1', productId: 'lap', subtotal: 50000 }],
        payments: [{ id: 'p1', date: '2026-10-01', amount: 50000, method: 'mpesa', recordedBy: 'x' }],
      } as any],
      posOrders: [{ id: 'o1', ref: 'POS/1', date: '2026-10-02', payment: 'cash', total: 8000, lines: [{ productId: 'prn', subtotal: 8000 }] } as any],
      expenses: [],
      journalEntries: [],
      deposits: [{ id: 'd1', ref: 'DEP/1', customerName: 'B', payments: [{ id: 'dp1', date: '2026-10-03', amount: 1000, method: 'cash' }] } as any],
      products,
    }, accounts as any)
    const category = (id: string) => entries.find(e => e.id === id)?.category
    expect(category('inv-pay-i1-p1')).toBe('Laptops')
    expect(category('pos-o1')).toBe('Printers')
    expect(category('dep-pay-d1-dp1')).toBe('Customer Deposits')
  })

  it('leaves the old behaviour when no products are supplied (balances never depend on it)', () => {
    const entries = buildCashbookEntries({
      invoices: [{ id: 'i1', type: 'customer_invoice', ref: 'INV/1', partnerName: 'A', lines: [], payments: [{ id: 'p1', date: '2026-10-01', amount: 100, method: 'cash' }] } as any],
      posOrders: [], expenses: [], journalEntries: [], deposits: [],
    }, [])
    expect(entries[0].credit).toBe(100)
    expect(entries[0].categoryTitle).toBeUndefined()
  })
})
