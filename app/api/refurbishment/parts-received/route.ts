import { NextRequest, NextResponse } from 'next/server'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { RECEIPT_VALIDATORS } from '@/lib/inventory/permissions'
import { refurbPartsReceivedOnOrder, type RefurbJobForQueue } from '@/lib/refurbishment/parts-request'
import { publishNotificationEvent } from '@/lib/notifications/service'

export const dynamic = 'force-dynamic'

type Job = RefurbJobForQueue & { assignedTechnicianId?: string }

/**
 * POST { poId, receiptRef? } — a purchase order raised for a refurbishment
 * part was received on its GRN: the part is in, and the technician is told.
 * Runs on the server because the Purchase screen does not load refurbishment
 * jobs. Nothing to do (no ordered part on that order) is not an error.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireRole([...RECEIPT_VALIDATORS])
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const poId = String(body.poId ?? '').trim()
    const receiptRef = String(body.receiptRef ?? '').trim().slice(0, 40)
    if (!poId) return NextResponse.json({ error: 'poId is required' }, { status: 422 })

    const done = await withAppStateKeyLock('deed_refurbishmentJobs', async () => {
      const state = await loadAppStateForWrite(['deed_refurbishmentJobs'])
      const jobs = (state.deed_refurbishmentJobs as Job[]) ?? []
      const result = refurbPartsReceivedOnOrder(jobs, poId, new Date().toISOString())
      if (!result) return null
      await saveStoreKeys({ deed_refurbishmentJobs: JSON.stringify(result.jobs) })
      return result
    })
    if (!done) return NextResponse.json({ ok: true, updated: false })

    const names = done.parts.map(p => `${p.partName} × ${p.qty}`).join(', ')
    if (done.job.assignedTechnicianId) {
      await publishNotificationEvent({
        eventType: 'refurbishment.part.received',
        entityType: 'refurbishment_job',
        entityId: done.job.id,
        actorUserId: user.id,
        userIds: [done.job.assignedTechnicianId],
        title: `Part ready for your refurb job — ${done.job.ref}`,
        body: `${names} received${receiptRef ? ` on ${receiptRef}` : ''}. Collect it and mark it used once fitted.`,
        actionUrl: `/refurbishment?id=${done.job.id}`,
        idempotencyKey: `refurb-part-received:${poId}`,
      }).catch(error => console.error('[refurb] part received notification failed:', error))
    }
    return NextResponse.json({ ok: true, updated: true, job: done.job, parts: done.parts })
  })
}
