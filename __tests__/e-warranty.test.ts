/** E-warranties: one per serial-numbered machine sold, on any channel, with a signed certificate link. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => {
  const read = async (keys: string[]) => Object.fromEntries(keys.map(k => [k, h.state[k] ? JSON.parse(JSON.stringify(h.state[k])) : undefined]))
  return {
    loadAppState: read,
    loadAppStateForWrite: read,
    saveStoreKeys: async (e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) h.state[k] = JSON.parse(v) },
    withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
    notifyStoreKeysChanged: async () => {},
  }
})

import { maskedName, nextWarrantyRefs, warrantiesToIssue, warrantyState, warrantyTerms } from '@/lib/warranty/e-warranty'
import { syncWarranties, warrantyByToken, warrantyToken } from '@/lib/warranty/e-warranty.server'

const serials = [
  { id: 's1', serial: '5CG111', productId: 'p1', status: 'sold', soldDate: '2026-10-01T10:00:00Z', specs: 'i5, 8GB' },
  { id: 's2', serial: '5CG222', productId: 'p1', status: 'sold', soldDate: '2026-10-02T10:00:00Z' },
  { id: 's3', serial: '5CG333', productId: 'p2', status: 'available' }, // refunded: back in stock
  { id: 's4', serial: 'KM444', productId: 'p2', status: 'sold', soldDate: '2026-10-03T10:00:00Z' },
]
const products = [{ id: 'p1', name: 'HP EliteBook 840 G5', warrantyMonths: 6 }, { id: 'p2', name: 'Dell Latitude 5490', warrantyMonths: 0 }]
const sources = {
  deliveries: [{ id: 'd1', ref: 'DN/1', status: 'done', saleOrderRef: 'SO/0001', customerId: 'c1', customerName: 'Wycliffe Ouma Sumba', lines: [{ productId: 'p1', productName: 'HP EliteBook 840 G5', serialIds: ['s1'] }] }],
  posOrders: [
    { id: 'pos1', ref: 'POS/0001', date: '2026-10-02', customerName: '', lines: [{ productId: 'p1', productName: 'HP EliteBook 840 G5', serialId: 's2' }, { productId: 'acc', productName: 'Mouse' }] },
    { id: 'pos2', ref: 'POS/0002', date: '2026-10-02', lines: [{ productId: 'p2', serialId: 's3' }] },
  ],
  kilimallOrders: [{ id: 'k1', ref: 'KIL/1', kilimallRef: '998877', status: 'dispatched', productId: 'p2', productName: 'Dell Latitude 5490', serialId: 's4', customerName: 'Jane' }],
  serials, products, defaultMonths: 3,
}

describe('who gets a warranty', () => {
  it('every serial-numbered machine still with its buyer, on any channel, once', () => {
    const out = warrantiesToIssue([], sources as any)
    expect(out.map(w => [w.sourceKey, w.serialNumber, w.months, w.startDate, w.endDate])).toEqual([
      ['delivery:d1', '5CG111', 6, '2026-10-01', '2027-04-01'],
      ['pos:pos1', '5CG222', 6, '2026-10-02', '2027-04-02'],
      ['kilimall:k1', 'KM444', 3, '2026-10-03', '2027-01-03'], // product has none: the default
    ])
    expect(out[1].customerName).toBe('Walk-in customer')
    expect(out[0].specs).toBe('i5, 8GB')
    expect(out[2].saleOrderRef).toBe('Kilimall 998877')
  })

  it('skips machines that already have one (incl. old delivery warranties) or an open one', () => {
    const existing = [
      { id: 'w1', ref: 'WAR/0010', serialId: 's1', deliveryId: 'd1', status: 'active' },
      { id: 'w2', ref: 'WAR/0011', serialId: 's2', deliveryId: '', status: 'active' },
    ] as any
    expect(warrantiesToIssue(existing, sources as any).map(w => w.serialId)).toEqual(['s4'])
  })

  it('a machine resold after a trade-in gets a new one', () => {
    const existing = [{ id: 'w1', ref: 'WAR/0001', serialId: 's2', sourceKey: 'pos:old', status: 'cancelled' }] as any
    expect(warrantiesToIssue(existing, sources as any).map(w => w.serialId)).toContain('s2')
  })
})

describe('helpers', () => {
  it('numbers, states, names and terms', () => {
    expect(nextWarrantyRefs([{ ref: 'WAR/0010' }, { ref: 'X' }], 2)).toEqual(['WAR/0011', 'WAR/0012'])
    const now = new Date('2026-11-07T10:00:00Z')
    expect(warrantyState({ status: 'active', endDate: '2027-01-01' }, now)).toBe('valid')
    expect(warrantyState({ status: 'active', endDate: '2026-11-06' }, now)).toBe('expired')
    expect(warrantyState({ status: 'cancelled', endDate: '2027-01-01' }, now)).toBe('void')
    expect(maskedName('Wycliffe Ouma Sumba')).toBe('Wycliffe O. S.')
    expect(warrantyTerms('6 months')[0].items[0].text).toContain('under normal use and service for 6 months starting from the date of purchase')
    expect(warrantyTerms('6 months').map(s => s.title)).toEqual(['Warranty Coverage', 'Warranty Exclusions', 'Warranty Service', 'Limitation of Liability', 'Governing Law', 'Entire Agreement'])
  })
})

describe('server', () => {
  beforeEach(() => {
    h.state = {
      deed_warranties: [{ id: 'w-old', ref: 'WAR/0010', serialId: 's1', deliveryId: 'd1', status: 'active', customerName: 'Wycliffe', endDate: '2027-04-01' }],
      deed_deliveries: sources.deliveries, deed_posOrders: sources.posOrders, deed_kilimallOrders: sources.kilimallOrders,
      deed_serials: serials, deed_products: products, deed_systemSettings: { invDefaultWarrantyMonths: 3 },
    }
  })

  it('issues the missing ones with the next numbers, and only once', async () => {
    expect(await syncWarranties()).toMatchObject({ issued: 2, total: 3 })
    expect(h.state.deed_warranties.map((w: any) => w.ref)).toEqual(['WAR/0010', 'WAR/0011', 'WAR/0012'])
    expect(await syncWarranties()).toMatchObject({ issued: 0, total: 3, added: [] })
  })

  it('the certificate link is signed: it opens its own warranty and cannot be forged', async () => {
    const token = warrantyToken('w-old')
    expect((await warrantyByToken(token))?.ref).toBe('WAR/0010')
    expect(await warrantyByToken('w-old.forgedsignature000000000')).toBeNull()
    expect(await warrantyByToken(token.replace('w-old', 'w-other'))).toBeNull()
  })
})
