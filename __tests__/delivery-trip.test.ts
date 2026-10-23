import { describe, expect, it } from 'vitest'
import {
  applyStopAction, carriedItems, closeFollowUp, confirmReturn, jobStops, openFollowUps, stopProgress, tripCashTotal,
  type TripJob,
} from '@/lib/delivery/trip'

const at = '2026-10-23T09:00:00.000Z'

function trip(): TripJob {
  return {
    id: 'j1', ref: 'DJB/0001', status: 'assigned', riderId: 'r1', customerName: 'Turaco',
    stops: [
      { id: 's1', kind: 'drop', address: 'Westlands', status: 'pending', items: [
        { id: 'a', direction: 'out', description: 'HP 840 G5', serial: '5CG1', qty: 1 },
        { id: 'b', direction: 'out', description: 'Charger', qty: 1 },
      ] },
      { id: 's2', kind: 'exchange', address: 'Upper Hill', status: 'pending', items: [
        { id: 'c', direction: 'out', description: 'Replacement Dell 5490', serial: 'DL2', qty: 1 },
        { id: 'd', direction: 'in', description: 'Faulty Dell 5490', serial: 'DL1', qty: 1 },
      ] },
      { id: 's3', kind: 'collect', address: 'Kilimani', status: 'pending', items: [
        { id: 'e', direction: 'in', description: 'MacBook for repair', qty: 1 },
      ] },
    ],
  }
}

const must = (r: ReturnType<typeof applyStopAction>) => { if (!r.ok) throw new Error(r.error); return r.job }

describe('delivery trips with several stops', () => {
  it('a job from before stops reads as one stop', () => {
    const stops = jobStops({ id: 'x', ref: 'R', status: 'assigned', deliveryAddress: 'CBD', customerName: 'A' })
    expect(stops).toHaveLength(1)
    expect(stops[0]).toMatchObject({ id: 'main', kind: 'drop', address: 'CBD', status: 'pending' })
  })

  it('a job from before stops completes through its one stop, cash included', () => {
    const job = must(applyStopAction({ id: 'x', ref: 'R', status: 'assigned', riderId: 'r1', deliveryAddress: 'CBD' }, 'r1',
      { action: 'stop_done', stopId: 'main', recipientName: 'Mary', cash: { amount: 500, method: 'cash' } }, at))
    expect(job).toMatchObject({ status: 'delivered', deliveredAt: at, recipientName: 'Mary' })
    expect(tripCashTotal(job)).toBe(500)
  })

  it('stays open with the collected items until the office checks them in', () => {
    let job = must(applyStopAction(trip(), 'r1', { action: 'stop_done', stopId: 's1', recipientName: 'Mary', items: { b: 'not_done' } }, at))
    expect(job.status).toBe('in_transit')
    job = must(applyStopAction(job, 'r1', { action: 'stop_done', stopId: 's2', recipientName: 'John', cash: { amount: 2000, method: 'mpesa', reference: 'SJK1' } }, at))
    job = must(applyStopAction(job, 'r1', { action: 'stop_failed', stopId: 's3', reason: 'Customer not in' }, at))
    expect(stopProgress(job)).toEqual({ done: 3, total: 3 })
    // charger not handed over, faulty Dell collected; MacBook never collected
    expect(carriedItems(job).map(i => i.id).sort()).toEqual(['b', 'd'])
    expect(job.status).toBe('in_transit')
    expect(job.stopsFinishedAt).toBe(at)
    expect(tripCashTotal(job)).toBe(2000)

    job = must(applyStopAction(job, 'r1', { action: 'back_at_shop' }, at))
    expect(job.backAtShopAt).toBe(at)

    const partly = confirmReturn(job, ['d'], 'Ann', at)
    if (!partly.ok) throw new Error(partly.error)
    expect(partly.job.status).toBe('in_transit')
    expect(carriedItems(partly.job).map(i => i.id)).toEqual(['b'])

    const done = confirmReturn(partly.job, ['b'], 'Ann', at)
    if (!done.ok) throw new Error(done.error)
    expect(done.job).toMatchObject({ status: 'delivered', returnConfirmedBy: 'Ann', deliveredAt: at, failureReason: 'Customer not in' })
  })

  it('finishes straight away when nothing comes back', () => {
    const job = must(applyStopAction({ ...trip(), stops: [trip().stops![0]] }, 'r1', { action: 'stop_done', stopId: 's1', recipientName: 'Mary' }, at))
    expect(job).toMatchObject({ status: 'delivered', recipientName: 'Mary' })
  })

  it('every stop failed and items back: the trip is failed, not delivered', () => {
    let job = must(applyStopAction({ ...trip(), stops: [trip().stops![0]] }, 'r1', { action: 'stop_failed', stopId: 's1', reason: 'Wrong address' }, at))
    expect(job.status).toBe('in_transit')
    const r = confirmReturn(job, ['a', 'b'], 'Ann', at)
    if (!r.ok) throw new Error(r.error)
    job = r.job
    expect(job.status).toBe('failed')
  })

  it('records what a customer handed over unplanned, for the office to follow up', () => {
    let job = must(applyStopAction({ ...trip(), stops: [trip().stops![0]] }, 'r1', {
      action: 'add_item', stopId: 's1', id: 'u1', description: 'Old charger', reason: 'return', billOnInvoice: true, note: 'Wrong wattage',
    }, at))
    expect(openFollowUps(job)).toHaveLength(1)
    job = must(applyStopAction(job, 'r1', { action: 'stop_done', stopId: 's1', recipientName: 'Mary' }, at))
    expect(job.status).toBe('in_transit')
    expect(carriedItems(job).map(i => i.id)).toEqual(['u1'])
    const back = confirmReturn(job, ['u1'], 'Ann', at)
    if (!back.ok) throw new Error(back.error)
    expect(back.job.status).toBe('delivered')
    expect(openFollowUps(back.job)).toHaveLength(1) // still needs billing / credit
    const closed = closeFollowUp(back.job, 'u1', 'Credit note CN/2026/0012', 'Finance', at)
    if (!closed.ok) throw new Error(closed.error)
    expect(openFollowUps(closed.job)).toHaveLength(0)
  })

  it('refuses updates from another rider, on finished stops, and without a name', () => {
    expect(applyStopAction(trip(), 'r2', { action: 'stop_done', stopId: 's1', recipientName: 'Mary' }).ok).toBe(false)
    expect(applyStopAction(trip(), 'r1', { action: 'stop_done', stopId: 's1', recipientName: ' ' }).ok).toBe(false)
    const job = must(applyStopAction(trip(), 'r1', { action: 'stop_failed', stopId: 's1', reason: 'Closed' }, at))
    expect(applyStopAction(job, 'r1', { action: 'stop_done', stopId: 's1', recipientName: 'Mary' }).ok).toBe(false)
    expect(applyStopAction(job, 'r1', { action: 'back_at_shop' }).ok).toBe(false) // stops not finished
  })

  it('a repeated add-item tap does not add it twice', () => {
    const input = { action: 'add_item' as const, stopId: 's1', id: 'u1', description: 'Mouse', reason: 'other' as const }
    const once = must(applyStopAction(trip(), 'r1', input, at))
    const twice = must(applyStopAction(once, 'r1', input, at))
    expect(twice.stops![0].items.filter(i => i.id === 'u1')).toHaveLength(1)
  })
})

import { mergeDeliveryJobsStoreWrite } from '@/lib/delivery/delivery-store-merge'

describe('office saves from an older copy', () => {
  it('keep the stops, check-ins and status the server has', () => {
    const office = { ...trip(), riderFee: 400 }
    const server = must(applyStopAction(trip(), 'r1', { action: 'stop_done', stopId: 's1', recipientName: 'Mary' }, at))
    const [merged] = mergeDeliveryJobsStoreWrite([server], [office]) as any[]
    expect(merged.riderFee).toBe(400)
    expect(merged.status).toBe('in_transit')
    expect(merged.stops[0].status).toBe('done')

    const checked = { ...server, tripUpdatedAt: '2026-10-23T10:00:00.000Z', returnConfirmedAt: '2026-10-23T10:00:00.000Z' }
    const [again] = mergeDeliveryJobsStoreWrite([checked], [server]) as any[]
    expect(again.returnConfirmedAt).toBe('2026-10-23T10:00:00.000Z')
  })
})
