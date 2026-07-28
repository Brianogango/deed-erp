import { describe, expect, it } from 'vitest'
import { explainSerialWhereabouts, findSerialMatches } from '@/lib/inventory/serial-trace'
import { canReleaseHeldSerial } from '@/lib/inventory/permissions'

describe('serial trace / lookup', () => {
  const serials = [
    {
      id: '1',
      serial: 'PF1CX9NP',
      productId: 'p1',
      productName: 'HP EliteBook 845 G7',
      status: 'sold',
      location: 'customer' as const,
      soldDate: '2026-07-01T10:00:00.000Z',
      saleOrderId: 'so1',
      receivedDate: '2026-01-01T10:00:00.000Z',
    },
    {
      id: '2',
      serial: 'OTHER',
      productId: 'p1',
      productName: 'HP EliteBook 845 G7',
      status: 'assigned',
      location: 'warehouse' as const,
      receivedDate: '2026-01-02T10:00:00.000Z',
    },
  ]

  it('finds serials case-insensitively', () => {
    expect(findSerialMatches('pf1cx9np', serials)).toHaveLength(1)
    expect(findSerialMatches('missing', serials)).toHaveLength(0)
  })

  it('explains sold serials as with customer', () => {
    const result = explainSerialWhereabouts({
      serial: serials[0],
      saleOrders: [{
        id: 'so1',
        ref: 'SO/0099',
        status: 'sale',
        customerName: 'Acme Ltd',
        lines: [{ serialIds: ['1'], productName: 'HP EliteBook 845 G7' }],
      }],
      stockMoves: [{
        id: 'm1',
        productId: 'p1',
        date: '2026-07-01T12:00:00.000Z',
        reason: 'Delivery validated',
        documentRef: 'DEL/001',
        serialNumbers: ['PF1CX9NP'],
      }],
    })
    expect(result.summary).toMatch(/Sold/)
    expect(result.details.some(d => d.includes('SO/0099'))).toBe(true)
    expect(result.relatedMoves).toHaveLength(1)
  })

  it('explains assigned serials as held on SO', () => {
    const result = explainSerialWhereabouts({
      serial: serials[1],
      saleOrders: [{
        id: 'so2',
        ref: 'QUO/0012',
        status: 'quotation',
        customerName: 'Jane',
        lines: [{ serialIds: ['2'] }],
      }],
    })
    expect(result.summary).toMatch(/Reserved|picked/i)
  })

  it('gates release permission to inventory controllers', () => {
    expect(canReleaseHeldSerial('inventory_officer')).toBe(true)
    expect(canReleaseHeldSerial('sales_rep')).toBe(false)
  })
})
