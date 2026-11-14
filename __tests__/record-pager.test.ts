import { describe, expect, it } from 'vitest'
import { pagerFor } from '@/lib/record-pager'

describe('pagerFor', () => {
  const list = ['inv-1', 'inv-2', 'inv-3']
  it('position and neighbours in the list it was opened from', () => {
    expect(pagerFor(list, 'inv-2')).toEqual({ position: 2, total: 3, prevId: 'inv-1', nextId: 'inv-3' })
  })
  it('wraps around at the ends, like Odoo', () => {
    expect(pagerFor(list, 'inv-1')).toMatchObject({ prevId: 'inv-3', nextId: 'inv-2' })
    expect(pagerFor(list, 'inv-3')).toMatchObject({ prevId: 'inv-2', nextId: 'inv-1' })
  })
  it('hidden when the record is not in the list, or is the only one', () => {
    expect(pagerFor(list, 'other')).toBeNull()
    expect(pagerFor(['inv-1'], 'inv-1')).toBeNull()
    expect(pagerFor(list, null)).toBeNull()
  })
})
