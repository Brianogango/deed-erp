import { describe, expect, it } from 'vitest'
import { findOrphanTradeInSerials, isTradeInIntake } from '@/lib/tradein/orphan-intake'

const now = new Date('2026-10-13T09:00:00Z')
const intake = (id: string, extra: Record<string, unknown> = {}) => ({
  id, serial: id.toUpperCase(), status: 'sold', location: 'customer',
  receivedDate: '2026-10-02T08:24:05.000Z', soldDate: '2026-10-02T08:24:05.000Z', ...extra,
})

describe('trade-in machines with no trade-in', () => {
  it('flags a machine registered on a trade-in screen that nothing holds (the Dragonfly)', () => {
    const out = findOrphanTradeInSerials({ serials: [intake('dragonfly')], buyBacks: [], now })
    expect(out.map(s => s.id)).toEqual(['dragonfly'])
  })

  it('does not flag one held by a buy-back, exchange, donation or return', () => {
    const serials = [intake('a'), intake('b'), intake('c'), intake('d')]
    const out = findOrphanTradeInSerials({
      serials, now,
      buyBacks: [{ lines: [{ serialIds: ['a'] }] }],
      clientExchanges: [{ returnLines: [{ serialIds: ['b'] }], newLines: [] }],
      donations: [{ lines: [{ serialIds: ['c'] }] }],
      returnOrders: [{ lines: [{ serialIds: ['d'] }] }],
    })
    expect(out).toEqual([])
  })

  it('gives a fresh registration a day to be finished', () => {
    const fresh = intake('x', { receivedDate: '2026-10-13T08:00:00Z', soldDate: '2026-10-13T08:00:00Z' })
    expect(findOrphanTradeInSerials({ serials: [fresh], now })).toEqual([])
  })

  it('ignores ordinary sales and stocked machines', () => {
    expect(isTradeInIntake({ status: 'sold', location: 'customer', receivedDate: '2026-08-01', soldDate: '2026-09-01' })).toBe(false)
    expect(isTradeInIntake({ status: 'sold', location: 'customer', saleOrderId: 'so1', receivedDate: '2026-10-02', soldDate: '2026-10-02' })).toBe(false)
    const stocked = intake('s', { status: 'available', location: 'warehouse' })
    expect(findOrphanTradeInSerials({ serials: [stocked], now })).toEqual([])
  })

  it('uses the screen mark when present: a return (RMA) intake is not a trade-in', () => {
    expect(isTradeInIntake(intake('r', { intakeSource: 'rma' }))).toBe(false)
    expect(isTradeInIntake(intake('t', { intakeSource: 'buyback', saleOrderId: 'so9' }))).toBe(true)
  })
})
