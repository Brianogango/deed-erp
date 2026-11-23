/**
 * Permanent delete from the Refurbishment screen: what may go, and how.
 *
 * Two ways:
 * - job_and_unit: the job and its machine leave the system, exactly like the
 *   inventory delete (lib/inventory/serial-delete.server.ts), which also
 *   refuses machines a sale, invoice, delivery, receipt or warranty names.
 * - job_only: the job goes; the machine stays where it is. A machine still in
 *   the repair unit shows again under "no job created yet"; a written-off
 *   machine stays written off.
 *
 * Refused here, before any of that: a job stripped for parts (its parts are in
 * stock carrying the machine's cost). A transferred or ready job is only a
 * record (transfer posts nothing), so it may go; with job_and_unit its machine
 * then faces the inventory delete's own checks. For job_and_unit the machine's
 * other jobs count too, so no harvest history is lost.
 *
 * Parts taken from stock for a deleted job and never fitted go back to stock.
 *
 * Pure: the server decides with this under the serials lock.
 */
import { refurbPartStockTaken } from './refurb-parts'

type Row = Record<string, any>
export type RefurbDeleteMode = 'job_and_unit' | 'job_only'

export type RefurbDeletePlan = {
  /** Jobs to remove by id, whatever happens to their machine. */
  jobIds: string[]
  /** Machines to delete from the system (job_and_unit). */
  serialIds: string[]
  refused: Array<{ id: string; label: string; why: string }>
}

export function refurbJobBlocker(job: Row): string | null {
  if (job?.outcome === 'harvested') return 'Stripped for parts — its parts are in stock'
  return null
}

export function planRefurbDelete(input: {
  jobs: Row[]
  serials: Row[]
  jobIds: string[]
  serialIds: string[]
  mode: RefurbDeleteMode
}): RefurbDeletePlan {
  const plan: RefurbDeletePlan = { jobIds: [], serialIds: [], refused: [] }
  const jobById = new Map(input.jobs.map(j => [String(j.id), j]))
  const serialById = new Map(input.serials.map(s => [String(s.id), s]))
  const jobsOfUnit = (serialId: string) => input.jobs.filter(j => String(j.serialId) === serialId)
  const unitLabel = (id: string) => String(serialById.get(id)?.serial ?? id)

  if (input.mode === 'job_only') {
    for (const id of input.serialIds) plan.refused.push({ id, label: unitLabel(id), why: 'Has no job — choose Job and machine to delete it' })
    for (const id of input.jobIds) {
      const job = jobById.get(id)
      if (!job) { plan.refused.push({ id, label: id, why: 'Not found' }); continue }
      const why = refurbJobBlocker(job)
      if (why) plan.refused.push({ id, label: String(job.ref ?? id), why })
      else plan.jobIds.push(id)
    }
    return plan
  }

  const units = new Set<string>()
  const jobsGoing = new Set<string>()
  const consider = (serialId: string, label: string, refId: string) => {
    const blocked = jobsOfUnit(serialId).map(j => [j, refurbJobBlocker(j)] as const).find(([, why]) => why)
    if (blocked) {
      const [j, why] = blocked
      plan.refused.push({ id: refId, label, why: refId === String(j.id) ? String(why) : `${j.ref ?? 'An earlier job'}: ${why}` })
      return false
    }
    return true
  }
  for (const id of input.jobIds) {
    const job = jobById.get(id)
    if (!job) { plan.refused.push({ id, label: id, why: 'Not found' }); continue }
    const serialId = String(job.serialId ?? '')
    if (!consider(serialId, String(job.ref ?? id), id)) continue
    // The machine is already gone from stock: only the job is left to remove.
    if (!serialId || !serialById.has(serialId)) jobsGoing.add(id)
    else units.add(serialId)
  }
  for (const id of input.serialIds) {
    if (units.has(id)) continue
    if (!serialById.has(id)) { plan.refused.push({ id, label: id, why: 'Not found' }); continue }
    if (consider(id, unitLabel(id), id)) units.add(id)
  }
  plan.jobIds = [...jobsGoing]
  plan.serialIds = [...units]
  return plan
}

/** Parts a removed job took from stock and never fitted: they go back. */
export function refurbPartsToReturn(jobs: Row[]): Array<{ jobId: string; jobRef: string; partId: string }> {
  return jobs.flatMap(j => (Array.isArray(j.partsNeeded) ? j.partsNeeded : [])
    .filter((p: Row) => p?.productId && p.status !== 'used' && refurbPartStockTaken(p))
    .map((p: Row) => ({ jobId: String(j.id), jobRef: String(j.ref ?? ''), partId: String(p.id) })))
}
