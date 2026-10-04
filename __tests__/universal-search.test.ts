import { describe, expect, it } from 'vitest'
import { searchRecords } from '@/lib/universal-search'

const sources = {
  repairs: [{ id: 'r1', ref: 'REP/2026/0101', customerName: 'Jane Wanjiru', customerPhone: '+254 712 345 678', productName: 'HP 840 G5', serialNumber: '5CG9150HTW', status: 'in_repair' }],
  serials: [
    { id: 's1', serial: '5CD3147PPX', productName: 'HP ProBook 455', location: 'shop', status: 'available' },
    { id: 's2', serial: 'PC127S2M', productName: 'ThinkPad T480s', location: 'customer', status: 'sold', saleOrderId: 'so9' },
  ],
  contacts: [{ id: 'c1', name: 'Jane Wanjiru', phone: '0712345678', isCustomer: true }],
  saleOrders: [{ id: 'so9', ref: 'SO/2026/0050', customerName: 'Acme Ltd', total: 45000, status: 'sale' }],
  invoices: [{ id: 'i1', ref: 'INV/2026/0042', partnerName: 'Acme Ltd', total: 45000, status: 'posted', type: 'customer_invoice' }],
  deliveries: [{ id: 'd1', ref: 'DN/2026/0009', customerName: 'Acme Ltd', saleOrderId: 'so9', saleOrderRef: 'SO/2026/0050', status: 'ready' }],
}
const find = (q: string) => searchRecords(sources, q, id => `/finance?invoice=${id}`)

describe('searching everything', () => {
  it('finds a repair by the serial on the machine', () => {
    expect(find('5cg9150htw').map(h => [h.type, h.id])).toEqual([['repair', 'r1']])
  })

  it('finds a customer and their repair by phone, however it is written', () => {
    const hits = find('0712 345 678')
    expect(hits.map(h => h.type)).toEqual(['repair', 'contact'])
    expect(hits.find(h => h.type === 'contact')!.href).toBe('/contacts?id=c1&contactTab=history')
  })

  it('says where a device is and opens the right place', () => {
    const inStock = find('5cd3147ppx')[0]
    expect(inStock).toMatchObject({ type: 'serial', subtitle: 'HP ProBook 455 · With Issues' })
    expect(inStock.href).toContain('location=issues')
    expect(find('pc127s2m')[0]).toMatchObject({ subtitle: 'ThinkPad T480s · sold', href: '/sales?id=so9' })
  })

  it('matches document numbers with or without slashes', () => {
    expect(find('so20260050').map(h => h.type)).toEqual(['sale_order'])
    expect(find('INV/2026/0042')[0]).toMatchObject({ type: 'invoice', href: '/finance?invoice=i1' })
    expect(find('dn/2026/0009')[0]).toMatchObject({ type: 'delivery', href: '/sales?id=so9' })
  })

  it('needs at least two characters, and short numbers do not match every phone', () => {
    expect(find('a')).toEqual([])
    expect(find('678').some(h => h.type === 'contact')).toBe(false)
  })
})
