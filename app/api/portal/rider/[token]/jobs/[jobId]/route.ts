import { NextRequest, NextResponse } from 'next/server'
import { cleanPortalText, guardPortalRoute } from '@/lib/portal/portal-guard.server'
import { hasRiderSession, needPin, noStore, riderForToken, updateDeliveryJob } from '@/lib/delivery/rider-portal.server'
import { applyRiderAction, riderJobView, type RiderAction } from '@/lib/delivery/rider-portal'
import { applyStopAction, UNPLANNED_REASON_LABELS, type StopAction, type UnplannedReason } from '@/lib/delivery/trip'
import { markRepairDeliveredByRider } from '@/lib/delivery/repair-delivered.server'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string; jobId: string }> }

/**
 * POST { action: 'picked_up' }
 *    | { action: 'delivered', recipientName, cash?: { amount, method: 'cash'|'mpesa', reference? } }
 *    | { action: 'failed', reason }
 *    | { action: 'stop_done', stopId, recipientName, items?: { [itemId]: 'done'|'not_done' }, cash? }
 *    | { action: 'stop_failed', stopId, reason }
 *    | { action: 'add_item', stopId, id, description, serial?, qty?, reason, note?, billOnInvoice? }
 *    | { action: 'back_at_shop' }
 */
export const POST = guardPortalRoute('rider-update', 300, async (req: NextRequest, { params }: Params) => {
  const { token, jobId } = await params
  const rider = await riderForToken(token)
  if (!rider) return NextResponse.json({ error: 'This link is no longer active.' }, { status: 404, headers: noStore })
  if (!hasRiderSession(req, rider)) return needPin(rider)

  const body = await req.json().catch(() => ({})) as Record<string, any>
  const cashOf = (c: any) => c && Number(c.amount) > 0
    ? { amount: Number(c.amount), method: c.method === 'mpesa' ? 'mpesa' as const : 'cash' as const, reference: cleanPortalText(c.reference, 40) }
    : undefined
  let stopInput: StopAction | null = null
  if (body.action === 'stop_done') {
    const items: Record<string, 'done' | 'not_done'> = {}
    for (const [k, v] of Object.entries(body.items ?? {})) items[String(k).slice(0, 64)] = v === 'not_done' ? 'not_done' : 'done'
    stopInput = { action: 'stop_done', stopId: String(body.stopId ?? ''), recipientName: cleanPortalText(body.recipientName, 80), items, cash: cashOf(body.cash) }
  } else if (body.action === 'stop_failed') {
    stopInput = { action: 'stop_failed', stopId: String(body.stopId ?? ''), reason: cleanPortalText(body.reason, 240) }
  } else if (body.action === 'add_item') {
    const reason = (['return', 'repair', 'exchange', 'other'] as const).includes(body.reason) ? body.reason as UnplannedReason : 'other'
    const id = String(body.id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
    if (id.length < 6) return NextResponse.json({ error: 'Try again' }, { status: 400, headers: noStore })
    stopInput = {
      action: 'add_item', stopId: String(body.stopId ?? ''), id: `u-${id}`,
      description: cleanPortalText(body.description, 160), serial: cleanPortalText(body.serial, 60),
      qty: Number(body.qty) || 1, reason, note: cleanPortalText(body.note, 240), billOnInvoice: body.billOnInvoice === true,
    }
  } else if (body.action === 'back_at_shop') stopInput = { action: 'back_at_shop' }
  if (stopInput) {
    const input = stopInput
    const result = await updateDeliveryJob(String(jobId), job => applyStopAction(job as any, rider.id, input) as any)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status === 404 ? 409 : result.status, headers: noStore })
    await afterRiderUpdate(rider.name, result.before as any, result.job as any, input)
    return NextResponse.json({ job: riderJobView(result.job) }, { headers: noStore })
  }

  let input: RiderAction
  if (body.action === 'picked_up') input = { action: 'picked_up' }
  else if (body.action === 'delivered') {
    const method = body.cash?.method === 'mpesa' ? 'mpesa' as const : 'cash' as const
    input = {
      action: 'delivered',
      recipientName: cleanPortalText(body.recipientName, 80),
      cash: body.cash && Number(body.cash.amount) > 0
        ? { amount: Number(body.cash.amount), method, reference: cleanPortalText(body.cash.reference, 40) }
        : undefined,
    }
  } else if (body.action === 'failed') input = { action: 'failed', reason: cleanPortalText(body.reason, 240) }
  else return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: noStore })

  const result = await updateDeliveryJob(String(jobId), job => applyRiderAction(job, rider.id, input))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status === 404 ? 409 : result.status, headers: noStore })

  await afterRiderUpdate(rider.name, result.before as any, result.job as any, input)
  return NextResponse.json({ job: riderJobView(result.job) }, { headers: noStore })
})

const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`

async function notify(event: Record<string, unknown>) {
  try {
    const { publishNotificationEvent } = await import('@/lib/notifications/service')
    await publishNotificationEvent({ entityType: 'delivery_job', actionUrl: '/delivery', ...event } as any)
  } catch (err) {
    console.error('[rider-portal] notification failed:', err)
  }
}

/** Tell the office what changed, and finish linked work. Best effort: the update is already saved. */
async function afterRiderUpdate(riderName: string, before: any, job: any, input: { action: string } & Record<string, any>) {
  if (input.action === 'add_item') {
    const stop = (job.stops ?? []).find((s: any) => s.id === input.stopId)
    const item = stop?.items?.find((i: any) => i.id === input.id)
    if (item && !(before.stops ?? []).some((s: any) => s.items?.some((i: any) => i.id === input.id))) {
      await notify({
        eventType: 'delivery.rider_item_added',
        entityId: job.id,
        title: `${riderName} was handed something unplanned — ${job.ref}`,
        body: `${item.qty} × ${item.description}${item.serial ? ` (${item.serial})` : ''} at ${stop.address || job.customerName || 'a stop'} · ${UNPLANNED_REASON_LABELS[item.unplanned?.reason as UnplannedReason] ?? 'Other'}${item.unplanned?.billOnInvoice ? ' · customer says bill it on their invoice' : ''}${item.unplanned?.note ? ` · ${item.unplanned.note}` : ''}`,
        idempotencyKey: `delivery:${job.id}:item:${item.id}`,
      })
    }
  }
  if (input.action === 'back_at_shop' && !before.backAtShopAt && job.backAtShopAt) {
    await notify({
      eventType: 'delivery.rider_back',
      entityId: job.id,
      title: `${riderName} is back with items from ${job.ref}`,
      body: 'Check the items in on the Delivery page to close the trip.',
      idempotencyKey: `delivery:${job.id}:back`,
    })
  }
  const stopsJustFinished = !before.stopsFinishedAt && job.stopsFinishedAt && job.status === 'in_transit'
  if (stopsJustFinished) {
    await notify({
      eventType: 'delivery.rider_completed',
      entityId: job.id,
      title: `${job.ref}: all stops done by ${riderName} — items coming back`,
      body: 'The rider is bringing items back. Check them in when they arrive.',
      idempotencyKey: `delivery:${job.id}:rider:stops_finished`,
    })
  }
  if (job.status !== before.status && (job.status === 'delivered' || job.status === 'failed')) {
    const cashTotal = (job.stops ?? []).reduce((t: number, s: any) => t + (Number(s.cashCollected?.amount) || 0), 0) || Number(job.cashCollected?.amount) || 0
    await notify({
      eventType: job.status === 'delivered' ? 'delivery.rider_completed' : 'delivery.failed',
      entityId: job.id,
      title: job.status === 'delivered' ? `${job.ref} delivered by ${riderName}` : `${job.ref} not delivered — ${riderName}`,
      body: job.status === 'delivered'
        ? `Received by ${job.recipientName ?? '—'} (${job.customerName ?? 'customer'})${cashTotal ? ` · rider collected ${kes(cashTotal)}` : ''}`
        : `Reason: ${job.failureReason ?? '—'}`,
      idempotencyKey: `delivery:${job.id}:rider:${job.status}`,
    })
    if (job.status === 'delivered' && job.type === 'repair_dropoff' && job.repairOrderId) {
      await markRepairDeliveredByRider(job, riderName).catch(err => console.error('[rider-portal] repair delivered failed:', err))
    }
  }
}
