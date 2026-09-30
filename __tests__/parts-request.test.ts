import { describe, expect, it } from 'vitest'
import {
  countCorrectionBlocker, needsCountCorrection, partsQueue, partsStep, purchaseOrderBlocker,
  requestAfterCountCheck, requestAfterPurchaseOrder, type PartsRequest, type RepairForParts,
} from '@/lib/repair/parts-request'

const SCREEN = 'prod-screen'
const request = (over: Partial<PartsRequest> = {}): PartsRequest => ({
  id: 'req-1', requestedBy: 'u-tech', requestedByName: 'Kevin', requestedDate: '2026-09-25T09:00:00Z',
  urgency: 'normal', status: 'pending', notes: '',
  items: [{ type: 'part', productId: '', productName: 'Unknown item', description: 'Dell 5400 screen', qty: '1', estimatedCost: '6500', supplier: '' }],
  ...over,
})
const repair = (over: Partial<RepairForParts> = {}): RepairForParts => ({
  id: 'r-1', ref: 'REP/0101', status: 'awaiting_parts', productName: 'Dell Latitude 5400', procurementRequests: [request()], ...over,
})

describe('the steps, in the order the shop works', () => {
  it('a new request is corrected-then-ordered, an ordered one awaits delivery', () => {
    expect(partsStep(request(), 'awaiting_parts')).toBe('adjust_then_order')
    expect(partsStep(request({ status: 'ordered' }), 'awaiting_parts')).toBe('awaiting_delivery')
    expect(partsStep(request({ status: 'received' }), 'awaiting_parts')).toBe('mark_arrived')
    expect(partsStep(request({ status: 'received' }), 'approved')).toBeNull()
    expect(partsStep(request({ status: 'cancelled' }), 'awaiting_parts')).toBeNull()
  })

  it('asks for a count correction only when the system shows stock nobody has checked', () => {
    expect(needsCountCorrection(request(), SCREEN, 2)).toBe(true)
    expect(needsCountCorrection(request(), SCREEN, 0)).toBe(false)
    expect(needsCountCorrection(request({ countCheckedProductIds: [SCREEN] }), SCREEN, 2)).toBe(false)
  })

  it('will not correct more than the system shows', () => {
    expect(countCorrectionBlocker(0, 1)).toContain('nothing to correct')
    expect(countCorrectionBlocker(2, 3)).toContain('only shows 2')
    expect(countCorrectionBlocker(2, 0)).toContain('Enter how many')
    expect(countCorrectionBlocker(2, 2)).toBeNull()
  })
})

describe('raising the purchase order', () => {
  const line = { productId: SCREEN, productName: 'Dell 5400 screen', qty: 1, unitPrice: 6500 }

  it('waits for the count to be corrected when the system still shows the part', () => {
    expect(purchaseOrderBlocker(request(), 'v-1', [line], () => 2)).toContain('correct the count first')
    const checked = requestAfterCountCheck(request(), SCREEN, 'ADJ/0042')
    expect(purchaseOrderBlocker(checked, 'v-1', [line], () => 2)).toBeNull()
  })

  it('goes straight ahead when the system shows none', () => {
    expect(purchaseOrderBlocker(request(), 'v-1', [line], () => 0)).toBeNull()
  })

  it('needs a vendor, a catalogue product and a price', () => {
    expect(purchaseOrderBlocker(request(), '', [line], () => 0)).toContain('vendor')
    expect(purchaseOrderBlocker(request(), 'v-1', [{ ...line, productId: '' }], () => 0)).toContain('catalogue product')
    expect(purchaseOrderBlocker(request(), 'v-1', [{ ...line, unitPrice: Number.NaN }], () => 0)).toContain('price')
  })

  it('is not raised twice for the same request', () => {
    expect(purchaseOrderBlocker(request({ status: 'ordered' }), 'v-1', [line], () => 0)).toContain('already been ordered')
  })

  it('records the order on the request', () => {
    const next = requestAfterPurchaseOrder(request(), { id: 'po-9', ref: 'PO/2026/0310' }, '2026-09-30')
    expect(next).toMatchObject({ status: 'ordered', purchaseOrderId: 'po-9', orderReference: 'PO/2026/0310', orderedDate: '2026-09-30' })
  })

  it('keeps every correction made against the request', () => {
    const once = requestAfterCountCheck(request(), SCREEN, 'ADJ/0042')
    const twice = requestAfterCountCheck(once, 'prod-battery', 'ADJ/0043')
    expect(twice.adjustmentRefs).toEqual(['ADJ/0042', 'ADJ/0043'])
    expect(twice.countCheckedProductIds).toEqual([SCREEN, 'prod-battery'])
  })
})

describe('the queue', () => {
  it('puts urgent requests first, then the oldest', () => {
    const rows = partsQueue([
      repair({ id: 'a', ref: 'REP/A', procurementRequests: [request({ id: 'old', requestedDate: '2026-09-20' })] }),
      repair({ id: 'b', ref: 'REP/B', procurementRequests: [request({ id: 'new', requestedDate: '2026-09-29' })] }),
      repair({ id: 'c', ref: 'REP/C', procurementRequests: [request({ id: 'urgent', urgency: 'urgent', requestedDate: '2026-09-29' })] }),
    ], '2026-09-30')
    expect(rows.map(r => r.request.id)).toEqual(['urgent', 'old', 'new'])
    expect(rows[1].ageDays).toBe(10)
  })

  it('offers "mark parts arrived" once per repair, and only when nothing is still outstanding', () => {
    const done = partsQueue([repair({ procurementRequests: [request({ id: 'x', status: 'received' }), request({ id: 'y', status: 'received' })] })], '2026-09-30')
    expect(done.map(r => r.step)).toEqual(['mark_arrived'])
    const waiting = partsQueue([repair({ procurementRequests: [request({ id: 'x', status: 'received' }), request({ id: 'y', status: 'ordered' })] })], '2026-09-30')
    expect(waiting.map(r => r.step)).toEqual(['awaiting_delivery'])
  })

  it('drops repairs that are back at work', () => {
    expect(partsQueue([repair({ status: 'in_progress', procurementRequests: [request({ status: 'received' })] })], '2026-09-30')).toEqual([])
  })
})
