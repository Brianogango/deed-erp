import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, saved, adjust } = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  saved: [] as Array<Record<string, string>>,
  adjust: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({
  loadAppState: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(k => [k, state[k]]))),
  saveStoreKeys: vi.fn(async (v: Record<string, string>) => { saved.push(v) }),
  notifyStoreKeysChanged: vi.fn(),
  withAppStateKeyLock: vi.fn(async (_k: string, fn: () => unknown) => fn()),
}))
vi.mock('@/lib/prisma', () => ({ default: { $transaction: async (fn: (tx: unknown) => unknown) => fn({}) } }))
vi.mock('@/lib/inventory/stock-level', () => ({ adjustStockLevel: adjust, createZeroStockLevel: vi.fn() }))
vi.mock('@/lib/inventory/reservation-mirror', () => ({ mirrorStockReservationsToPrisma: vi.fn() }))

import { releaseDeliveryReservations, reverseDeliveryStockMutation } from '@/lib/inventory/stock-transactions'

const PROD = '11111111-1111-4111-8111-111111111111'
const lastSaved = (key: string) => JSON.parse(saved.filter(s => key in s).at(-1)![key])

describe('cancelling a delivery returns non-serial stock to free stock', () => {
  beforeEach(() => {
    saved.length = 0
    adjust.mockReset()
    for (const k of Object.keys(state)) delete state[k]
  })

  it('an open (prepared) delivery releases its reservation; other deliveries keep theirs', async () => {
    state.deed_stockReservations = [
      { id: 'r1', productId: PROD, qty: 5, status: 'reserved', deliveryId: 'dn-1', referenceId: 'so-1' },
      { id: 'r2', productId: PROD, qty: 3, status: 'reserved', deliveryId: 'dn-2', referenceId: 'so-1' },
    ]
    const released = await releaseDeliveryReservations({ deliveryId: 'dn-1', deliveryRef: 'DN/1' })
    expect(released).toBe(5)
    const rows = lastSaved('deed_stockReservations')
    expect(rows.find((r: any) => r.id === 'r1').status).toBe('cancelled')
    expect(rows.find((r: any) => r.id === 'r2').status).toBe('reserved')
    expect(adjust).toHaveBeenCalledWith({}, PROD, { reserved: -5 })
  })

  it('a reversed (shipped) delivery puts bulk stock back on hand without re-reserving it', async () => {
    state.deed_products = [{ id: PROD, name: 'Mouse', stockQty: 10, trackingMethod: 'QUANTITY' }]
    state.deed_serials = []
    state.deed_bulkStock = []
    state.deed_stockMoves = []
    state.deed_stockReservations = [
      { id: 'r1', productId: PROD, qty: 5, status: 'fulfilled', fulfilledQty: 5, deliveryId: 'dn-1', referenceId: 'so-1' },
      { id: 'r2', productId: PROD, qty: 3, status: 'reserved', deliveryId: 'dn-2', referenceId: 'so-1' },
    ]
    await reverseDeliveryStockMutation({ deliveryId: 'dn-1', deliveryRef: 'DN/1', saleOrderId: 'so-1', lines: [{ productId: PROD, productName: 'Mouse', qty: 5 }] })
    const rows = lastSaved('deed_stockReservations')
    expect(rows.find((r: any) => r.id === 'r1').status).toBe('cancelled')
    expect(rows.find((r: any) => r.id === 'r2').status).toBe('reserved')
    expect(adjust).toHaveBeenCalledWith({}, PROD, { onHand: 5, reserved: -0 })
    expect(lastSaved('deed_products')[0].stockQty).toBe(15)
  })
})
