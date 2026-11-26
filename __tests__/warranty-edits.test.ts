import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelWarrantiesForSale, changeWarrantyMonths, restoreWarranty } from '@/lib/warranty/warranty-edits'

const now = '2026-11-26T10:00:00.000Z'
const w = (over: Record<string, any> = {}): any => ({
  id: 'w1', ref: 'WAR/0001', serialId: 's1', serialNumber: 'SN1', customerName: 'Jane',
  startDate: '2026-06-01', endDate: '2026-12-01', months: 6, status: 'active' as const, ...over,
})

describe('restoring a warranty cancelled by mistake', () => {
  it('brings it back as active and keeps why it was cancelled', () => {
    const out = restoreWarranty([w({ status: 'cancelled', cancelledReason: 'Typo', cancelledAt: now })], 'w1', { by: 'Faith', now })
    expect(out.changed).toMatchObject({ status: 'active', restoredBy: 'Faith', restoredFrom: 'Typo', cancelledReason: undefined })
  })
  it('refuses while the machine has another open warranty', () => {
    const out = restoreWarranty([w({ status: 'cancelled' }), w({ id: 'w2', ref: 'WAR/0002' })], 'w1', { by: 'Faith', now })
    expect(out.error).toMatch(/WAR\/0002/)
  })
  it('refuses one that is not cancelled', () => {
    expect(restoreWarranty([w()], 'w1', { by: 'F', now }).error).toMatch(/not cancelled/)
  })
})

describe('correcting the length', () => {
  it('6 → 12 months moves the end date from the same start', () => {
    const out = changeWarrantyMonths([w()], 'w1', 12, { by: 'Faith', now, reason: 'Sold with 12 months' })
    expect(out.changed).toMatchObject({ months: 12, endDate: '2027-06-01', startDate: '2026-06-01', lengthChangedFrom: 6, lengthChangeReason: 'Sold with 12 months' })
  })
  it('an expired warranty extended becomes active again', () => {
    expect(changeWarrantyMonths([w({ status: 'expired' })], 'w1', 12, { by: 'F', now, reason: 'x' }).changed?.status).toBe('active')
  })
  it('needs a reason, a real change and whole months 1–60; not on a cancelled one', () => {
    expect(changeWarrantyMonths([w()], 'w1', 12, { by: 'F', now, reason: ' ' }).error).toMatch(/why/)
    expect(changeWarrantyMonths([w()], 'w1', 6, { by: 'F', now, reason: 'x' }).error).toMatch(/already/)
    expect(changeWarrantyMonths([w()], 'w1', 0, { by: 'F', now, reason: 'x' }).error).toMatch(/1 to 60/)
    expect(changeWarrantyMonths([w()], 'w1', 7.5, { by: 'F', now, reason: 'x' }).error).toMatch(/1 to 60/)
    expect(changeWarrantyMonths([w({ status: 'cancelled' })], 'w1', 12, { by: 'F', now, reason: 'x' }).error).toMatch(/restore/)
  })
})

describe('ending the warranties of an undone sale', () => {
  it('cancels only the picked open ones, with the document', () => {
    const list = [w(), w({ id: 'w2' }), w({ id: 'w3', status: 'cancelled', cancelledReason: 'old' })]
    const out = cancelWarrantiesForSale(list, ['w1', 'w3'], { now, reason: 'Invoice INV/0009 cancelled', byRef: 'INV/0009' })
    expect(out.cancelled.map(c => c.id)).toEqual(['w1'])
    expect(out.list.find(x => x.id === 'w1')).toMatchObject({ status: 'cancelled', cancelledByRef: 'INV/0009' })
    expect(out.list.find(x => x.id === 'w2')!.status).toBe('active')
    expect(out.list.find(x => x.id === 'w3')!.cancelledReason).toBe('old')
  })
})

// Server: a reversed delivery ends the warranties issued from it.
const store: Record<string, any> = {}
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-store', () => ({
  loadAppState: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, store[k] ?? []])),
  loadAppStateForWrite: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, store[k] ?? []])),
  saveStoreKeys: async (e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) store[k] = JSON.parse(v) },
  notifyStoreKeysChanged: async () => {},
  withAppStateKeyLock: async (_k: string, fn: () => Promise<unknown>) => fn(),
}))

describe('cancelSaleWarranties', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    store.deed_warranties = [
      w({ id: 'a', deliveryId: 'd1', sourceKey: 'delivery:d1' }),
      w({ id: 'b', serialId: 's2', serialNumber: 'SN2', deliveryId: 'd2', sourceKey: 'delivery:d2' }),
    ]
  })

  it('ends the warranties of the reversed delivery only', async () => {
    const { cancelSaleWarranties } = await import('@/lib/warranty/e-warranty.server')
    const n = await cancelSaleWarranties({ deliveryId: 'd1' }, { reason: 'Delivery DEL/1 reversed', byRef: 'DEL/1' })
    expect(n).toBe(1)
    expect(store.deed_warranties.find((x: any) => x.id === 'a')).toMatchObject({ status: 'cancelled', cancelledByRef: 'DEL/1' })
    expect(store.deed_warranties.find((x: any) => x.id === 'b').status).toBe('active')
  })

  it('ends only the machines named on a cancelled invoice, not the rest of the order', async () => {
    store.deed_invoices = [{ id: 'inv1', saleOrderId: 'so1', lines: [{ serial: 'SN1' }] }]
    store.deed_deliveries = [{ id: 'd1', saleOrderId: 'so1' }, { id: 'd2', saleOrderId: 'so1' }]
    const { cancelSaleWarranties } = await import('@/lib/warranty/e-warranty.server')
    const n = await cancelSaleWarranties({ invoiceId: 'inv1' }, { reason: 'Invoice INV/1 cancelled', byRef: 'INV/1' })
    expect(n).toBe(1)
    expect(store.deed_warranties.find((x: any) => x.id === 'a').status).toBe('cancelled')
    expect(store.deed_warranties.find((x: any) => x.id === 'b').status).toBe('active')
  })
})
