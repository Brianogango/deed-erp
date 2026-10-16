import { describe, it, expect } from 'vitest'
import { compareSerialCount } from '@/lib/inventory/serial-count-compare'

const serials = [
  { serial: '5CG2151FN4', productId: 'p1', status: 'available', location: 'warehouse' },
  { serial: '5CG2151FMM', productId: 'p1', status: 'available', location: 'warehouse' },
  { serial: 'PF1CL8VH', productId: 'p2', status: 'refurbishment', location: 'refurb' },
  { serial: '5CD1051CDH', productId: 'p3', status: 'available', location: 'warehouse' },
  { serial: 'SOLD0001', productId: 'p1', status: 'sold', location: 'customer' },
]
const products = [{ id: 'p1', name: 'HP 830 G8' }, { id: 'p2', name: 'L490' }, { id: 'p3', name: 'Omen' }]

describe('compareSerialCount()', () => {
  it('lists unsold system serials that were not counted, with product, status and location', () => {
    const r = compareSerialCount({ counted: ['5CG2151FN4'], serials, products })
    expect(r.missing.map(m => m.serial).sort()).toEqual(['5CD1051CDH', '5CG2151FMM', 'PF1CL8VH'])
    expect(r.missing.find(m => m.serial === 'PF1CL8VH')).toMatchObject({ productName: 'L490', status: 'refurbishment', location: 'refurb' })
    expect(r.summary.systemUnsold).toBe(4)
  })

  it('ignores case, spaces and punctuation when matching', () => {
    const r = compareSerialCount({ counted: ['5cg2151 fn4', '5CG-2151-FMM'], serials, products })
    expect(r.missing.map(m => m.serial).sort()).toEqual(['5CD1051CDH', 'PF1CL8VH'])
  })

  it('matches a look-alike spelling (letter O for zero) and reports it for confirmation', () => {
    const r = compareSerialCount({ counted: ['5CD1O51CDH'], serials, products })
    expect(r.lookAlike).toHaveLength(1)
    expect(r.lookAlike[0]).toMatchObject({ counted: '5CD1O51CDH', serial: '5CD1051CDH' })
    expect(r.missing.map(m => m.serial)).not.toContain('5CD1051CDH')
    expect(r.notInSystem).toEqual([])
  })

  it('reports unknown serials, sold ones and serials listed twice', () => {
    const r = compareSerialCount({ counted: ['ZZZ999999', 'SOLD0001', '5CG2151FN4', '5CG2151FN4'], serials, products })
    expect(r.notInSystem.map(n => n.counted)).toEqual(['ZZZ999999'])
    expect(r.soldInSystem.map(n => n.serial)).toEqual(['SOLD0001'])
    expect(r.duplicates).toEqual(['5CG2151FN4'])
    expect(r.summary).toMatchObject({ counted: 4, uniqueCounted: 3 })
  })
})
