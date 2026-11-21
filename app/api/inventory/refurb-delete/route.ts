import { NextRequest, NextResponse } from 'next/server'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'
import { withAppStateKeyLock, loadAppState, saveStoreKeys } from '@/lib/server-store'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { deleteSerialsFromSystem } from '@/lib/inventory/serial-delete.server'
import { planRefurbDelete, refurbPartsToReturn, type RefurbDeleteMode } from '@/lib/refurbishment/refurb-delete'

export const dynamic = 'force-dynamic'

const list = (v: unknown) => (Array.isArray(v) ? v : []) as Array<Record<string, any>>
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(String).filter(Boolean))].slice(0, 500) : [])

/**
 * Permanently delete refurbishment jobs, with or without their machines
 * (lib/refurbishment/refurb-delete.ts). Director only, same permission as the
 * inventory delete. Cannot be undone; the audit entry keeps what went and why.
 *
 * The response lists parts the removed jobs had taken from stock and never
 * fitted; the browser puts them back, as write-off does.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requirePermission('inventory.serials.delete')
    const body = await req.json().catch(() => ({})) as { jobIds?: unknown; serialIds?: unknown; mode?: unknown; reason?: unknown }
    const jobIds = ids(body.jobIds)
    const serialIds = ids(body.serialIds)
    const mode: RefurbDeleteMode = body.mode === 'job_only' ? 'job_only' : 'job_and_unit'
    const reason = String(body.reason ?? '').trim().slice(0, 300)
    if (!jobIds.length && !serialIds.length) return NextResponse.json({ error: 'Choose at least one job or machine' }, { status: 400 })
    if (!reason) return NextResponse.json({ error: 'Say why these are being deleted' }, { status: 422 })
    const reference = `DEL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).slice(-4).toUpperCase()}`

    return withAppStateKeyLock('deed_serials', async () => {
      const before = await loadAppState(['deed_refurbishmentJobs', 'deed_serials'])
      const jobsBefore = list(before.deed_refurbishmentJobs)
      const plan = planRefurbDelete({ jobs: jobsBefore, serials: list(before.deed_serials), jobIds, serialIds, mode })
      const refused = [...plan.refused]
      const deletedUnits: Array<{ id: string; serial: string; productName: string }> = []

      // Machines first: the inventory delete removes them and all their jobs,
      // or refuses a machine a document still names.
      if (plan.serialIds.length) {
        const r = await deleteSerialsFromSystem({ serialIds: plan.serialIds, reason, userId: user.id, reference })
        deletedUnits.push(...r.deleted)
        for (const x of r.refused) {
          const job = jobsBefore.find(j => String(j.serialId) === x.id && jobIds.includes(String(j.id)))
          refused.push({ id: job ? String(job.id) : x.id, label: job ? String(job.ref ?? x.serial) : x.serial, why: x.why })
        }
      }
      // Then jobs removed on their own (job only, or a machine already gone).
      if (plan.jobIds.length) {
        const now = list((await loadAppState(['deed_refurbishmentJobs'])).deed_refurbishmentJobs)
        const going = new Set(plan.jobIds)
        await saveStoreKeys({ deed_refurbishmentJobs: JSON.stringify(now.filter(j => !going.has(String(j.id)))) }, { allowBulkDelete: ['deed_refurbishmentJobs'] })
      }

      const after = new Set(list((await loadAppState(['deed_refurbishmentJobs'])).deed_refurbishmentJobs).map(j => String(j.id)))
      const removedJobs = jobsBefore.filter(j => !after.has(String(j.id)))
      const partsToReturn = refurbPartsToReturn(removedJobs)

      if (removedJobs.length || deletedUnits.length) {
        await writeFinancialAudit({
          userId: user.id,
          action: 'delete_refurbishment',
          entityType: 'refurbishment_job',
          entityId: reference,
          newValues: {
            reference, reason, mode,
            jobs: removedJobs.map(j => `${j.ref} (${j.serialNumber ?? ''}, ${j.status})`),
            machines: deletedUnits.map(d => `${d.serial} (${d.productName})`),
            partsReturned: partsToReturn.length,
          },
        }).catch(() => {})
      }
      return NextResponse.json({
        ok: true, reference, mode,
        removedJobs: removedJobs.map(j => ({ id: String(j.id), ref: String(j.ref ?? '') })),
        deletedUnits, refused, partsToReturn,
      })
    })
  })
}
