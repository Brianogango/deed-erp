import { describe, it, expect } from 'vitest'
import { exchangeCancellations, pairExchangeSerials, warrantiesForDocument, warrantiesToIssue, type WarrantyRow } from '@/lib/warranty/e-warranty'

const products = [{ id: 'p1', name: 'HP EliteBook 840 G5', warrantyMonths: 12 }, { id: 'p2', name: 'Dell 5490', warrantyMonths: 12 }]
// Bought in June with 12 months; exchanged in November.
const original = (over: Partial<WarrantyRow> = {}): WarrantyRow => ({
  id: 'w1', ref: 'WAR/0001', customerId: 'c1', customerName: 'Acme Ltd', productId: 'p1', productName: 'HP EliteBook 840 G5',
  serialId: 'old1', serialNumber: '5CGOLD1', deliveryId: 'd1', saleOrderRef: 'SO/0042',
  startDate: '2026-06-10', endDate: '2027-06-10', status: 'cancelled', months: 12, source: 'delivery', sourceKey: 'delivery:d1',
  cancelledByRef: 'EXC/0004', ...over,
})
const exchange = {
  id: 'x1', ref: 'EXC/0004', status: 'completed', customerId: 'c1', customerName: 'Acme Ltd', originalSORef: 'SO/0042',
  completedDate: '2026-11-20T10:00:00Z',
  returnLines: [{ productId: 'p1', serialIds: ['old1', 'old2'] }],
  newLines: [{ productId: 'p1', productName: 'HP EliteBook 840 G5', serialIds: ['new1', 'new2'] }],
}
const serials = [
  { id: 'old1', serial: '5CGOLD1', productId: 'p1', status: 'available' },
  { id: 'old2', serial: '5CGOLD2', productId: 'p1', status: 'available' },
  { id: 'new1', serial: '5CGNEW1', productId: 'p1', status: 'sold', soldDate: '2026-11-20' },
  { id: 'new2', serial: '5CGNEW2', productId: 'p1', status: 'sold', soldDate: '2026-11-20' },
]
const src = (exchanges: any[]) => ({ deliveries: [], posOrders: [], kilimallOrders: [], serials, products, exchanges })

describe('exchange warranties', () => {
  it('the machine given carries on the warranty of the one handed back: same dates, same sale', () => {
    const existing = [original(), original({ id: 'w2', ref: 'WAR/0002', serialId: 'old2', serialNumber: '5CGOLD2' })]
    const out = warrantiesToIssue(existing, src([exchange]) as any)
    expect(out.map(w => [w.serialNumber, w.startDate, w.endDate, w.saleOrderRef, w.deliveryId, w.replacesSerialNumber, w.exchangeRef])).toEqual([
      ['5CGNEW1', '2026-06-10', '2027-06-10', 'SO/0042', 'd1', '5CGOLD1', 'EXC/0004'],
      ['5CGNEW2', '2026-06-10', '2027-06-10', 'SO/0042', 'd1', '5CGOLD2', 'EXC/0004'],
    ])
    // Once issued, never again.
    const issued = out.map((c, i) => ({ ...c, id: `n${i}`, ref: `WAR/01${i}` })) as WarrantyRow[]
    expect(warrantiesToIssue([...existing, ...issued], src([exchange]) as any)).toEqual([])
  })

  it('the original invoice now finds the new machines, not the old ones', () => {
    const existing = [original()]
    const issued = warrantiesToIssue(existing, src([{ ...exchange, returnLines: [{ productId: 'p1', serialIds: ['old1'] }], newLines: [{ productId: 'p1', serialIds: ['new1'] }] }]) as any)
      .map((c, i) => ({ ...c, id: `n${i}`, ref: `WAR/01${i}` })) as WarrantyRow[]
    const onInvoice = warrantiesForDocument([...existing, ...issued], { deliveryIds: ['d1'], saleOrderRefs: ['SO/0042'] })
    expect(onInvoice.map(w => w.serialNumber)).toEqual(['5CGNEW1'])
  })

  it('a POS sale still finds the replacement by the original sale', () => {
    const pos = original({ deliveryId: '', sourceKey: 'pos:p9', source: 'pos', saleOrderRef: 'POS/0009' })
    const issued = warrantiesToIssue([pos], src([{ ...exchange, returnLines: [{ productId: 'p1', serialIds: ['old1'] }], newLines: [{ productId: 'p1', serialIds: ['new1'] }] }]) as any)
      .map((c, i) => ({ ...c, id: `n${i}`, ref: `WAR/01${i}` })) as WarrantyRow[]
    expect(warrantiesForDocument([pos, ...issued], { posOrderIds: ['p9'] }).map(w => w.serialNumber)).toEqual(['5CGNEW1'])
  })

  it('no warranty on file for the machine handed back: a fresh one from the exchange date, on the original order', () => {
    const out = warrantiesToIssue([], src([{ ...exchange, returnLines: [{ productId: 'p1', serialIds: ['old1'] }], newLines: [{ productId: 'p1', serialIds: ['new1'] }] }]) as any)
    expect(out.map(w => [w.startDate, w.endDate, w.saleOrderRef])).toEqual([['2026-11-20', '2027-11-20', 'SO/0042']])
  })

  it('closes warranties still open on machines handed back (older exchanges)', () => {
    const open = original({ status: 'active', cancelledByRef: undefined })
    expect(exchangeCancellations([open], [exchange as any]).map(c => [c.id, c.exchangeRef])).toEqual([['w1', 'EXC/0004']])
    expect(exchangeCancellations([open], [{ ...exchange, status: 'approved' } as any])).toEqual([])
    // Resold later: that newer warranty is not touched.
    expect(exchangeCancellations([original({ status: 'active', startDate: '2026-12-01' })], [exchange as any])).toEqual([])
  })

  it('pairs by product first', () => {
    expect(pairExchangeSerials({
      returnLines: [{ productId: 'p2', serialIds: ['r2'] }, { productId: 'p1', serialIds: ['r1'] }],
      newLines: [{ productId: 'p1', serialIds: ['g1'] }, { productId: 'p3', serialIds: ['g3'] }],
    })).toEqual([{ given: 'g1', returned: 'r1' }, { given: 'g3', returned: 'r2' }])
  })
})
