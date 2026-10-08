import { describe, expect, it } from 'vitest'
import { mergeScreenExtras, readScreenExtras, SALE_ORDER_EXTRA_KEYS } from '@/lib/screen-extras'

describe('screen extras', () => {
  it('replaces the keys a write sends and keeps the rest', () => {
    const stored = { approvalStatus: 'pending', stockReservationIds: ['r1'] }
    expect(mergeScreenExtras(stored, { approvalStatus: 'approved', total: 5 }, SALE_ORDER_EXTRA_KEYS))
      .toEqual({ approvalStatus: 'approved', stockReservationIds: ['r1'] })
  })

  it('clears a key sent as null or empty, and stores nothing when empty', () => {
    expect(mergeScreenExtras({ approvalStatus: 'pending' }, { approvalStatus: null }, SALE_ORDER_EXTRA_KEYS)).toBeNull()
    expect(mergeScreenExtras(null, { sentByName: '' }, SALE_ORDER_EXTRA_KEYS)).toBeNull()
  })

  it('reads only known keys', () => {
    expect(readScreenExtras({ approvalStatus: 'x', other: 1 }, SALE_ORDER_EXTRA_KEYS)).toEqual({ approvalStatus: 'x' })
  })
})
