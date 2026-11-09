import { describe, expect, it } from 'vitest'
import { parseIntakeSheet } from '@/lib/refurbishment/intake-sheet'

const products = [
  { id: 'p1', name: 'HP EliteBook 840 G5', requiresSerial: true },
  { id: 'p2', name: 'Dell Latitude 5490', trackingMethod: 'SERIAL' },
  { id: 'p3', name: 'USB Mouse', requiresSerial: false },
]
const serials = [
  { id: 's1', serial: '5CG81236', status: 'available', location: 'warehouse', productName: 'HP EliteBook 840 G5', assetId: 'DT000005' },
  { id: 's2', serial: 'OLD123', status: 'sold', location: 'customer' },
]

describe('intake sheet', () => {
  it('matches models, keeps optional fields, skips blank lines', () => {
    const rows = parseIntakeSheet([
      { Model: 'hp elitebook 840 g5', Serial: '', 'Asset ID': ' lt000200 ', Issues: 'No display', Cost: '12,500' },
      {},
      { Model: 'Dell Latitude', Cost: '' },
      { Model: 'Lenovo Something' },
    ], products, serials)
    expect(rows.map(r => [r.line, r.productId, r.assetId, r.cost, r.problem])).toEqual([
      [2, 'p1', 'LT000200', 12500, null],
      [4, 'p2', '', null, null],
      [5, null, '', null, null],
    ])
    expect(rows[0].issue).toBe('No display')
  })

  it('flags problems per row', () => {
    const rows = parseIntakeSheet([
      { Serial: 'X1' },
      { Model: 'HP EliteBook 840 G5', Serial: '5CG81236' },
      { Model: 'HP EliteBook 840 G5', Serial: 'OLD123' },
      { Model: 'HP EliteBook 840 G5', 'Asset ID': 'DT000005' },
      { Model: 'HP EliteBook 840 G5', 'Asset ID': 'LT-1' },
      { Model: 'HP EliteBook 840 G5', Cost: 'abc' },
      { Model: 'HP EliteBook 840 G5', Serial: 'NEW999' },
      { Model: 'HP EliteBook 840 G5', Serial: 'new999' },
    ], products, serials)
    expect(rows.map(r => r.problem)).toEqual([
      'Model is missing',
      'Serial already in stock (HP EliteBook 840 G5)',
      'We had this serial before (sold) — use a return or trade-in',
      'Asset ID is already on another machine',
      'Asset ID should be letters then digits, e.g. LT000124',
      'Cost "abc" is not a number',
      null,
      'Serial is listed twice',
    ])
  })
})
