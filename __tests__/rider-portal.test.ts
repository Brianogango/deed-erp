import { describe, expect, it } from 'vitest'
import { applyRiderAction, onRiderLink, pinMatches, riderJobView, riderPin, riderSession, riderWeeks, sessionValid, weekStartOf } from '@/lib/delivery/rider-portal'
import { mergeDeliveryJobsStoreWrite, mergeRidersStoreWrite } from '@/lib/delivery/delivery-store-merge'

const job = (o: Record<string, any> = {}) => ({ id: 'j1', ref: 'DLV-1', status: 'assigned', riderId: 'r1', customerName: 'Acme', customerPhone: '0700', riderFee: 300, ...o })

describe('rider PIN and session', () => {
  it('PIN is the last 4 of the ID, else of the phone', () => {
    expect(riderPin({ idNumber: '12 345 678', phone: '0712000999' })).toBe('5678')
    expect(riderPin({ idNumber: '', phone: '0712000999' })).toBe('0999')
    expect(riderPin({})).toBeNull()
    expect(pinMatches({ idNumber: '12345678' }, '5678')).toBe(true)
    expect(pinMatches({ idNumber: '12345678' }, '1234')).toBe(false)
  })
  it('a new link ends old sessions', () => {
    const cookie = riderSession({ id: 'r1', portalToken: 'a'.repeat(24) })
    expect(sessionValid({ id: 'r1', portalToken: 'a'.repeat(24) }, cookie)).toBe(true)
    expect(sessionValid({ id: 'r1', portalToken: 'b'.repeat(24) }, cookie)).toBe(false)
  })
})

describe('rider job updates', () => {
  it('picked up, then delivered with the recipient name and cash', () => {
    const p = applyRiderAction(job(), 'r1', { action: 'picked_up' }, '2026-10-23T08:00:00Z')
    expect(p).toMatchObject({ ok: true, job: { status: 'in_transit', pickedUpAt: '2026-10-23T08:00:00Z' } })
    const d = applyRiderAction((p as any).job, 'r1', { action: 'delivered', recipientName: 'Jane W', cash: { amount: 4500, method: 'mpesa', reference: 'SJK1' } }, '2026-10-23T09:00:00Z')
    expect(d).toMatchObject({ ok: true, job: { status: 'delivered', recipientName: 'Jane W', cashCollected: { amount: 4500, method: 'mpesa', reference: 'SJK1' }, riderUpdatedAt: '2026-10-23T09:00:00Z' } })
  })
  it('refuses another rider, a missing name, an M-Pesa payment without its code, and finished jobs', () => {
    expect(applyRiderAction(job(), 'r2', { action: 'picked_up' })).toMatchObject({ ok: false })
    expect(applyRiderAction(job(), 'r1', { action: 'delivered', recipientName: ' ' })).toMatchObject({ ok: false })
    expect(applyRiderAction(job(), 'r1', { action: 'delivered', recipientName: 'Jane', cash: { amount: 100, method: 'mpesa' } })).toMatchObject({ ok: false })
    expect(applyRiderAction(job({ status: 'delivered' }), 'r1', { action: 'failed', reason: 'Wrong address' })).toMatchObject({ ok: false })
  })
  it('a failed delivery needs a reason', () => {
    expect(applyRiderAction(job(), 'r1', { action: 'failed', reason: 'Wrong address' })).toMatchObject({ ok: true, job: { status: 'failed', failureReason: 'Wrong address' } })
  })
  it('the customer phone is hidden once the job is finished', () => {
    expect(riderJobView(job()).customerPhone).toBe('0700')
    expect(riderJobView(job({ status: 'delivered' })).customerPhone).toBe('')
  })
})

describe('trips by week', () => {
  it('counts delivered trips, fee and cash per Monday-week, and marks paid weeks', () => {
    expect(weekStartOf('2026-10-23T09:00:00Z')).toBe('2026-10-19')
    const weeks = riderWeeks('r1', [
      job({ status: 'delivered', deliveredAt: '2026-10-21T09:00:00Z', cashCollected: { amount: 1000, method: 'cash', at: '' } }),
      job({ id: 'j2', status: 'delivered', deliveredAt: '2026-10-22T09:00:00Z' }),
      job({ id: 'j3', status: 'delivered', deliveredAt: '2026-10-14T09:00:00Z' }),
      job({ id: 'j4', status: 'failed', deliveredAt: '2026-10-22T09:00:00Z' }),
      job({ id: 'j5', riderId: 'r2', status: 'delivered', deliveredAt: '2026-10-22T09:00:00Z' }),
    ], [{ riderId: 'r1', weekStart: '2026-10-19', status: 'paid' }], 3, '2026-11-04T09:00:00Z')
    // Weeks start at the rider link's first week (19 Oct): earlier weeks are not listed.
    expect(weeks).toEqual([
      { weekStart: '2026-11-02', trips: 0, earned: 0, cashCollected: 0, paid: false },
      { weekStart: '2026-10-26', trips: 0, earned: 0, cashCollected: 0, paid: false },
      { weekStart: '2026-10-19', trips: 2, earned: 600, cashCollected: 1000, paid: true },
    ])
  })

  it('riders only see jobs dated from 19 October onwards', () => {
    expect(onRiderLink({ scheduledDate: '2026-10-18' })).toBe(false)
    expect(onRiderLink({ scheduledDate: '2026-10-19' })).toBe(true)
    expect(onRiderLink({ scheduledDate: '', createdAt: '2026-10-10T08:00:00Z' })).toBe(false)
    expect(onRiderLink({ scheduledDate: '' })).toBe(true)
    const old = riderWeeks('r1', [job({ status: 'delivered', scheduledDate: '2026-10-17', deliveredAt: '2026-10-20T09:00:00Z' })], [], 1, '2026-10-23T09:00:00Z')
    expect(old[0].trips).toBe(0)
  })
})

describe('office saves from an older copy', () => {
  it('keep the rider’s update on the job', () => {
    const server = [job({ status: 'delivered', recipientName: 'Jane', riderUpdatedAt: 't2', deliveredAt: 't2' })]
    const incoming = [job({ status: 'assigned', notes: 'call first' })]
    expect(mergeDeliveryJobsStoreWrite(server, incoming)).toEqual([job({ status: 'delivered', recipientName: 'Jane', riderUpdatedAt: 't2', deliveredAt: 't2', notes: 'call first' })])
  })
  it('a save made after seeing the rider’s update goes through', () => {
    const server = [job({ status: 'failed', failureReason: 'x', riderUpdatedAt: 't2' })]
    const incoming = [job({ status: 'assigned', failureReason: 'x', riderUpdatedAt: 't2', riderId: 'r3' })]
    expect(mergeDeliveryJobsStoreWrite(server, incoming)).toEqual(incoming)
  })
  it('keep the rider link token', () => {
    expect(mergeRidersStoreWrite([{ id: 'r1', name: 'A', portalToken: 'tok' }], [{ id: 'r1', name: 'A2' }])).toEqual([{ id: 'r1', name: 'A2', portalToken: 'tok' }])
  })
  it('keep the ID number when the saver was not shown it', () => {
    expect(mergeRidersStoreWrite([{ id: 'r1', name: 'A', idNumber: '12345678' }], [{ id: 'r1', name: 'A2', hasPortalLink: false }]))
      .toEqual([{ id: 'r1', name: 'A2', hasPortalLink: false, idNumber: '12345678' }])
    expect(mergeRidersStoreWrite([{ id: 'r1', idNumber: '1' }], [{ id: 'r1', idNumber: '2' }])).toEqual([{ id: 'r1', idNumber: '2' }])
  })
})
