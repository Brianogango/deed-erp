/**
 * Refurbishment parts in the shared parts-request queue: a requested part is
 * a pending request, ordering it writes the PO back onto the part, and
 * receiving that PO marks the part received (the job never stopped).
 */
import { describe, expect, it } from 'vitest'
import { partsQueue, purchaseOrderBlocker, requestAfterPurchaseOrder, requestAfterCountCheck } from '@/lib/repair/parts-request'
import {
  refurbJobsForPartsQueue, refurbPartAfterRequest, refurbPartRequest, refurbPartsReceivedOnOrder, refurbPartsOrderNote,
} from '@/lib/refurbishment/parts-request'

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1', ref: 'REF/0007', status: 'in_progress', productName: 'HP EliteBook 840 G5', intakeDate: '2026-11-01T08:00:00.000Z',
  assignedTechnicianName: 'Tech One',
  partsNeeded: [
    { id: 'p1', partName: '8GB DDR4 RAM', productId: 'ram', qty: 1, estimatedCost: 2500, status: 'requested', requestedDate: '2026-11-03T08:00:00.000Z', requestedByName: 'Tech One' },
    { id: 'p2', partName: 'Battery', productId: 'bat', qty: 1, estimatedCost: 4000, status: 'allocated' },
  ],
  ...over,
})

describe('refurbishment parts in the parts queue', () => {
  it('lists only requested or ordered parts of open jobs, next to repairs', () => {
    const rows = partsQueue([
      { id: 'r1', ref: 'RPR/0001', status: 'awaiting_parts', procurementRequests: [{ id: 'q1', requestedBy: 'u', requestedByName: 'A', requestedDate: '2026-11-02', urgency: 'normal', status: 'pending', notes: '', items: [] }] },
      ...refurbJobsForPartsQueue([job(), job({ id: 'j2', ref: 'REF/0008', status: 'transferred' })]),
    ], '2026-11-09')
    // Oldest first, whichever kind.
    expect(rows.map(r => `${r.kind}:${r.repairRef}:${r.request.id}:${r.step}`)).toEqual([
      'repair:RPR/0001:q1:adjust_then_order',
      'refurb:REF/0007:p1:adjust_then_order',
    ])
    expect(rows[1].request.items[0]).toMatchObject({ productId: 'ram', qty: '1', estimatedCost: '2500' })
    expect(rows[1].request.requestedByName).toBe('Tech One')
  })

  it('uses the repair rules: stock still showing must be counted before ordering', () => {
    const req = refurbPartRequest(job(), job().partsNeeded[0])!
    const line = [{ productId: 'ram', productName: '8GB DDR4 RAM', qty: 1, unitPrice: 2500 }]
    expect(purchaseOrderBlocker(req, 'v1', line, () => 2)).toMatch(/correct the count first/)
    const checked = requestAfterCountCheck(req, 'ram', 'ADJ/0003')
    expect(purchaseOrderBlocker(checked, 'v1', line, () => 2)).toBeNull()
    // The check is kept on the part, so the queue remembers it.
    const part = refurbPartAfterRequest(job().partsNeeded[0], checked)
    expect(part).toMatchObject({ status: 'requested', adjustmentRefs: ['ADJ/0003'], countCheckedProductIds: ['ram'] })
  })

  it('ordering writes the PO onto the part; receiving it marks the part received', () => {
    const base = job()
    const ordered = refurbPartAfterRequest(base.partsNeeded[0], requestAfterPurchaseOrder(refurbPartRequest(base, base.partsNeeded[0])!, { id: 'po9', ref: 'PO/0009' }, '2026-11-09'))
    expect(ordered).toMatchObject({ status: 'ordered', poId: 'po9', poRef: 'PO/0009', orderedDate: '2026-11-09' })
    const jobs = [{ ...base, partsNeeded: [ordered, base.partsNeeded[1]] }]
    // Still in the queue, waiting for delivery.
    expect(partsQueue(refurbJobsForPartsQueue(jobs), '2026-11-09')[0].step).toBe('awaiting_delivery')

    const out = refurbPartsReceivedOnOrder(jobs, 'po9', '2026-11-12T10:00:00.000Z')!
    expect(out.parts.map(p => p.id)).toEqual(['p1'])
    expect(out.job.partsNeeded[0]).toMatchObject({ status: 'received', receivedDate: '2026-11-12T10:00:00.000Z' })
    expect(out.job.partsNeeded[1].status).toBe('allocated')
    expect(refurbJobsForPartsQueue(out.jobs)).toEqual([])
    // Receiving it again, or another order, changes nothing.
    expect(refurbPartsReceivedOnOrder(out.jobs, 'po9', 'x')).toBeNull()
    expect(refurbPartsReceivedOnOrder(jobs, 'other', 'x')).toBeNull()
  })

  it('the order note names the job and the part', () => {
    expect(refurbPartsOrderNote(job(), { partName: '8GB DDR4 RAM' })).toContain('REF/0007')
  })
})
