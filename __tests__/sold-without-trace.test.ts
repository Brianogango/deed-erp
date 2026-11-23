import { describe, expect, it } from 'vitest'
import { findSoldWithoutTrace } from '@/lib/inventory/sold-without-trace'

const unit = (id: string, serial: string, extra: Record<string, unknown> = {}) =>
  ({ id, serial, productId: 'p-t480', productName: 'ThinkPad T480', status: 'sold', location: 'customer', ...extra })

const ids = (out: ReturnType<typeof findSoldWithoutTrace>) => out.map(u => u.id)

describe('units marked sold with no sale behind them', () => {
  it('flags a sold unit nothing names', () => {
    expect(ids(findSoldWithoutTrace({ serials: [unit('s1', 'PF1ABC')] }))).toEqual(['s1'])
  })

  it('ignores units that are not sold', () => {
    expect(findSoldWithoutTrace({ serials: [unit('s1', 'PF1ABC', { status: 'available' })] })).toEqual([])
  })

  it('a sale order line, delivery, invoice line, POS sale, Kilimall order or warranty is a trace', () => {
    const serials = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id, i) => unit(id, `SN${i}`))
    const out = findSoldWithoutTrace({
      serials,
      saleOrders: [{ id: 'so1', ref: 'SO/1', status: 'confirmed', lines: [{ serialIds: ['s1'] }] }],
      deliveries: [{ id: 'd1', ref: 'DN/1', status: 'done', lines: [{ serialIds: ['s2'] }] }],
      invoices: [{ id: 'i1', ref: 'INV/1', status: 'posted', lines: [{ serialNumberId: 's3' }] }],
      posOrders: [{ id: 'pos1', ref: 'POS/1', lines: [{ serialNumber: 'SN3' }] }],
      kilimallOrders: [{ id: 'k1', kilimallRef: 'KM1', status: 'delivered', serialId: 's5' }],
      warranties: [{ id: 'w1', status: 'expired', serialNumber: 'sn5' }],
    })
    expect(ids(out)).toEqual([])
  })

  it('a cancelled document is not a trace', () => {
    const out = findSoldWithoutTrace({
      serials: [unit('s1', 'PF1ABC', { saleOrderId: 'so1' })],
      saleOrders: [{ id: 'so1', ref: 'SO/1', status: 'cancelled', lines: [{ serialIds: ['s1'] }] }],
    })
    expect(ids(out)).toEqual(['s1'])
  })

  it('the unit\'s own sale-order link counts only when that order exists', () => {
    expect(ids(findSoldWithoutTrace({ serials: [unit('s1', 'A', { saleOrderId: 'gone' })] }))).toEqual(['s1'])
    expect(ids(findSoldWithoutTrace({
      serials: [unit('s1', 'A', { saleOrderId: 'so1' })],
      saleOrders: [{ id: 'so1', ref: 'SO/1', status: 'confirmed', lines: [] }],
    }))).toEqual([])
  })

  it('a stock movement counts only when it points at a sale document that exists', () => {
    const move = { serialNumbers: ['PF1ABC'], documentRef: 'POS/2026/0009', reason: 'POS sale', date: '2026-10-01' }
    const orphan = findSoldWithoutTrace({ serials: [unit('s1', 'PF1ABC')], stockMoves: [move] })
    expect(ids(orphan)).toEqual(['s1'])
    expect(orphan[0].lastMove?.documentRef).toBe('POS/2026/0009')
    expect(findSoldWithoutTrace({
      serials: [unit('s1', 'PF1ABC')],
      stockMoves: [move],
      posOrders: [{ id: 'p9', ref: 'POS/2026/0009', lines: [] }],
    })).toEqual([])
  })

  it('serial numbers match regardless of case and spaces', () => {
    expect(findSoldWithoutTrace({
      serials: [unit('s1', 'pf1abc')],
      posOrders: [{ id: 'p1', ref: 'POS/1', lines: [{ serialNumber: ' PF1ABC ' }] }],
    })).toEqual([])
  })
})

describe('putting them back into stock', async () => {
  const { vi } = await import('vitest')
  const state: Record<string, unknown> = {}
  const saved: Record<string, string>[] = []
  vi.doMock('server-only', () => ({}))
  vi.doMock('@/lib/server-store', () => ({
    loadAppState: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, state[k]])),
    saveStoreKeys: async (entries: Record<string, string>) => { saved.push(entries) },
  }))
  vi.doMock('@/lib/inventory/stock-transactions', () => ({ bumpPrismaOnHand: async () => {} }))
  const { returnSoldWithoutTrace } = await import('@/lib/inventory/sold-without-trace.server')

  it('returns an orphan to the warehouse and refuses a unit a sale names', async () => {
    state.deed_serials = [unit('s1', 'PF1ABC', { saleOrderId: 'gone' }), unit('s2', 'PF2XYZ')]
    state.deed_saleOrders = [{ id: 'so1', ref: 'SO/1', status: 'confirmed', lines: [{ serialIds: ['s2'] }] }]
    state.deed_products = [{ id: 'p-t480', name: 'ThinkPad T480', stockQty: 3 }]
    state.deed_stockMoves = []
    const result = await returnSoldWithoutTrace({ serialIds: ['s1', 's2'], reason: 'Found at count', location: 'warehouse', userId: 'u1', reference: 'UNSOLD-1' })
    expect(result.returned.map(u => u.id)).toEqual(['s1'])
    expect(result.refused).toEqual([{ id: 's2', why: expect.stringMatching(/After-Sales/) }])
    const last = saved[saved.length - 1]
    const serials = JSON.parse(last.deed_serials)
    expect(serials.find((s: { id: string }) => s.id === 's1')).toMatchObject({ status: 'available', location: 'warehouse', previousSaleOrderId: 'gone' })
    expect(serials.find((s: { id: string }) => s.id === 's2').status).toBe('sold')
    expect(JSON.parse(last.deed_products)[0].stockQty).toBe(4)
    expect(JSON.parse(last.deed_stockMoves)[0]).toMatchObject({ type: 'in', toLocation: 'warehouse', serialNumbers: ['PF1ABC'], documentRef: 'UNSOLD-1' })
  })
})
