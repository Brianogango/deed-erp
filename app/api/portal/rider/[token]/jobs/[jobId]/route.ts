import { NextRequest, NextResponse } from 'next/server'
import { cleanPortalText, guardPortalRoute } from '@/lib/portal/portal-guard.server'
import { hasRiderSession, needPin, noStore, riderForToken, updateDeliveryJob } from '@/lib/delivery/rider-portal.server'
import { applyRiderAction, riderJobView, type RiderAction } from '@/lib/delivery/rider-portal'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ token: string; jobId: string }> }

/**
 * POST { action: 'picked_up' }
 *    | { action: 'delivered', recipientName, cash?: { amount, method: 'cash'|'mpesa', reference? } }
 *    | { action: 'failed', reason }
 */
export const POST = guardPortalRoute('rider-update', 300, async (req: NextRequest, { params }: Params) => {
  const { token, jobId } = await params
  const rider = await riderForToken(token)
  if (!rider) return NextResponse.json({ error: 'This link is no longer active.' }, { status: 404, headers: noStore })
  if (!hasRiderSession(req, rider)) return needPin(rider)

  const body = await req.json().catch(() => ({})) as Record<string, any>
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

  // Tell the office (best effort: the update is saved either way).
  if (result.job.status !== result.before.status && (result.job.status === 'delivered' || result.job.status === 'failed')) {
    try {
      const { publishNotificationEvent } = await import('@/lib/notifications/service')
      const job = result.job
      const cash = job.cashCollected ? ` · collected KES ${job.cashCollected.amount.toLocaleString('en-KE')} (${job.cashCollected.method === 'mpesa' ? `M-Pesa ${job.cashCollected.reference ?? ''}` : 'cash'})` : ''
      await publishNotificationEvent({
        eventType: job.status === 'delivered' ? 'delivery.rider_completed' : 'delivery.failed',
        entityType: 'delivery_job',
        entityId: job.id,
        title: job.status === 'delivered'
          ? `${job.ref} delivered by ${rider.name}`
          : `${job.ref} not delivered — ${rider.name}`,
        body: job.status === 'delivered'
          ? `Received by ${job.recipientName} (${job.customerName ?? 'customer'})${cash}`
          : `Reason: ${job.failureReason}`,
        actionUrl: '/delivery',
        idempotencyKey: `delivery:${job.id}:rider:${job.status}`,
      } as any)
    } catch (err) {
      console.error('[rider-portal] notification failed:', err)
    }
  }
  return NextResponse.json({ job: riderJobView(result.job) }, { headers: noStore })
})
