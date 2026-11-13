import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { updateDeliveryJob } from '@/lib/delivery/rider-portal.server'
import { closeFollowUp, confirmReturn } from '@/lib/delivery/trip'
import { markRepairDeliveredByRider } from '@/lib/delivery/repair-delivered.server'

export const dynamic = 'force-dynamic'
type Params = { params: Promise<{ id: string }> }


/**
 * Office actions on a trip, done on the server so a rider's update and the
 * office's never overwrite each other:
 *   POST { action: 'confirm_return', itemIds: string[] } — these items came back to the shop
 *   POST { action: 'follow_up', itemId, note }           — an unplanned item was dealt with
 */
export async function POST(req: NextRequest, { params }: Params) {
  return withApiErrorHandling(async () => {
    const body = await req.json().catch(() => ({})) as Record<string, any>
    const { id } = await params
    const actor = await requirePermission(body.action === 'follow_up' ? 'delivery.rider_cash' : 'delivery.trip.check_in')
    const by = String((actor as any).name || (actor as any).username || 'Office')

    if (body.action === 'confirm_return') {
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String).slice(0, 200) : []
      const result = await updateDeliveryJob(id, job => confirmReturn(job as any, itemIds, by) as any)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      const job = result.job as any
      if (job.status === 'delivered' && result.before.status !== 'delivered' && job.type === 'repair_dropoff') {
        await markRepairDeliveredByRider(job, String(job.riderName ?? 'rider')).catch(err => console.error('[trip] repair delivered failed:', err))
      }
      return NextResponse.json({ job })
    }
    if (body.action === 'follow_up') {
      const result = await updateDeliveryJob(id, job => closeFollowUp(job as any, String(body.itemId ?? ''), String(body.note ?? '').slice(0, 240), by) as any)
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      return NextResponse.json({ job: result.job })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  })
}
