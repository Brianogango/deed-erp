import { describe, expect, it, vi } from 'vitest'
import { serialDeleteBlockers } from '@/lib/inventory/serial-delete'

const unit = (id: string, serial: string, extra: Record<string, unknown> = {}) =>
  ({ id, serial, productId: 'p1', productName: 'HP 840 G1', status: 'refurbishment', location: 'repair_unit', ...extra })

describe('which units may be deleted from the system', () => {
  it('keeps units a sale, invoice, delivery, receipt, POS sale, warranty or repair names', () => {
    const units = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => unit(id, `SN${i}`))
    const blocked = serialDeleteBlockers(units, {
      saleOrders: [{ ref: 'SO/1', status: 'confirmed', lines: [{ serialIds: ['a'] }] }],
      deliveries: [{ ref: 'DN/1', status: 'done', lines: [{ serialIds: ['b'] }] }],
      invoices: [{ ref: 'INV/1', status: 'posted', lines: [{ serialNumberId: 'c' }] }],
      receipts: [{ ref: 'REC/1', status: 'validated', lines: [{ serials: ['sn3'] }] }],
      posOrders: [{ ref: 'POS/1', lines: [{ serialNumber: 'SN4' }] }],
      warranties: [{ status: 'active', serialId: 'f' }],
      repairs: [{ ref: 'REP-1', status: 'received', serialId: 'g' }],
    })
    expect([...blocked.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(blocked.get('d')).toMatch(/REC\/1 — write it off/)
    expect(blocked.has('h')).toBe(false)
  })
  it('a cancelled document does not keep a unit; a sold unit is always kept', () => {
    const blocked = serialDeleteBlockers([unit('a', 'X'), unit('s', 'Y', { status: 'sold' })], {
      saleOrders: [{ ref: 'SO/1', status: 'cancelled', lines: [{ serialIds: ['a'] }] }],
    })
    expect(blocked.has('a')).toBe(false)
    expect(blocked.get('s')).toMatch(/Sold/)
  })
})

describe('deleting from the system', async () => {
  const state: Record<string, unknown> = {}
  const saved: Array<{ entries: Record<string, string>; opts: unknown }> = []
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const bump = vi.fn(async () => {})
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/prisma', () => ({ default: { serialNumber: { updateMany } } }))
  vi.doMock('@/lib/server-store', () => ({
    loadAppState: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, state[k]])),
    saveStoreKeys: async (entries: Record<string, string>, opts: unknown) => { saved.push({ entries, opts }) },
  }))
  vi.doMock('@/lib/inventory/stock-transactions', () => ({ bumpPrismaOnHand: bump }))
  const { deleteSerialsFromSystem } = await import('@/lib/inventory/serial-delete.server')

  it('removes the unit and its refurbishment job, lowers on hand, and refuses a received one', async () => {
    state.deed_serials = [unit('a', 'UNK-1'), unit('b', '5CG1', { status: 'available', location: 'warehouse' })]
    state.deed_products = [{ id: 'p1', name: 'HP 840 G1', stockQty: 2 }]
    state.deed_stockMoves = []
    state.deed_refurbishmentJobs = [{ id: 'j1', serialId: 'a' }, { id: 'j2', serialId: 'other' }]
    state.deed_receipts = [{ ref: 'REC/9', status: 'validated', lines: [{ serials: ['5CG1'] }] }]
    const r = await deleteSerialsFromSystem({ serialIds: ['a', 'b'], reason: 'Test records', userId: 'u1', reference: 'DEL-1' })
    expect(r.deleted.map(d => d.id)).toEqual(['a'])
    expect(r.refused).toEqual([{ id: 'b', serial: '5CG1', why: expect.stringMatching(/REC\/9/) }])
    expect(r.jobsRemoved).toBe(1)
    const { entries, opts } = saved[saved.length - 1]
    expect(JSON.parse(entries.deed_serials).map((s: { id: string }) => s.id)).toEqual(['b'])
    expect(JSON.parse(entries.deed_refurbishmentJobs).map((j: { id: string }) => j.id)).toEqual(['j2'])
    expect(JSON.parse(entries.deed_products)[0].stockQty).toBe(1)
    expect(JSON.parse(entries.deed_stockMoves)[0]).toMatchObject({ type: 'out', documentRef: 'DEL-1', serialNumbers: ['UNK-1'] })
    expect(opts).toEqual({ allowBulkDelete: ['deed_serials', 'deed_refurbishmentJobs'] })
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(bump).toHaveBeenCalledWith(new Map([['p1', -1]]))
  })
})
