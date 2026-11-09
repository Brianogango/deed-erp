/**
 * The one next step on a refurbishment job, for whoever is looking at it.
 * Shown at the top of the job so the flow reads in order:
 *   queued → assigned → started → issues recorded → parts → ready → retest.
 *
 * Pure.
 */
type PartLike = { status: string; notifiedTechDate?: string; productId?: string }
type JobLike = {
  status: string
  assignedTechnicianId?: string
  identityPending?: boolean
  issuesFound?: string
  partsNeeded: PartLike[]
}

export type RefurbNextStep = {
  key: 'assign' | 'start' | 'record_issues' | 'request_parts' | 'wait_parts' | 'fit_parts' | 'identify' | 'mark_ready' | 'retest' | 'none'
  title: string
  detail: string
  /** The viewer can act on it now. */
  mine: boolean
}

export const REFURB_FLOW_STEPS = ['Assigned', 'Started', 'Issues found', 'Parts', 'Ready', 'Retest'] as const

/** Index into REFURB_FLOW_STEPS of the step the job has reached (-1: not assigned). */
export function refurbFlowProgress(job: JobLike): number {
  if (['transferred'].includes(job.status)) return 5
  if (job.status === 'ready') return 4
  if (job.status === 'queued') return -1
  if (job.status === 'assigned') return 0
  const issues = Boolean(job.issuesFound?.trim())
  if (!issues) return 1
  const open = job.partsNeeded.filter(p => p.status !== 'used')
  return open.length ? 2 : 3
}

export function refurbNextStep(job: JobLike, viewer: { id?: string; isLead: boolean; canAssign: boolean }): RefurbNextStep {
  const isTech = !!viewer.id && job.assignedTechnicianId === viewer.id
  const actor = isTech || viewer.isLead
  if (job.status === 'written_off' || job.status === 'transferred') return { key: 'none', title: '', detail: '', mine: false }
  if (job.status === 'queued') {
    return { key: 'assign', title: 'Assign a technician', detail: 'The technician opens it up, records what is wrong and asks for the parts needed.', mine: viewer.canAssign }
  }
  if (job.status === 'assigned') {
    return { key: 'start', title: 'Start the job', detail: 'Press Start, then record the issues you find.', mine: actor }
  }
  if (job.status === 'ready') {
    return { key: 'retest', title: 'Send for retest', detail: 'The lead sends it for retest before it goes back to stock for sale.', mine: viewer.isLead }
  }
  // in progress
  if (!job.issuesFound?.trim()) {
    return { key: 'record_issues', title: 'Record the issues found', detail: 'Say what is wrong with the machine. Then add the parts and components it needs.', mine: actor }
  }
  const open = job.partsNeeded.filter(p => p.status !== 'used')
  const unlinked = open.filter(p => p.status === 'needed' && !p.productId)
  if (unlinked.length) {
    return { key: 'request_parts', title: `Link ${unlinked.length} part${unlinked.length === 1 ? '' : 's'} to inventory`, detail: 'Stores can only pull a part linked to an inventory item: edit the part and find it, or ask the lead to order it.', mine: actor }
  }
  const toRequest = open.filter(p => p.status === 'needed')
  if (toRequest.length) {
    return { key: 'request_parts', title: `Request ${toRequest.length} part${toRequest.length === 1 ? '' : 's'}`, detail: 'Send the listed parts to stores, or remove the ones you no longer need.', mine: actor }
  }
  const waiting = open.filter(p => ['requested', 'ordered'].includes(p.status))
  if (waiting.length) {
    return { key: 'wait_parts', title: `Waiting for ${waiting.length} part${waiting.length === 1 ? '' : 's'}`, detail: viewer.isLead ? 'Allocate them from stock or order them, then notify the technician.' : 'Stores or the lead will allocate or order them; you are notified when they are ready.', mine: viewer.isLead }
  }
  const toFit = open.filter(p => ['allocated', 'received'].includes(p.status))
  if (toFit.length) {
    return { key: 'fit_parts', title: `Fit ${toFit.length} part${toFit.length === 1 ? '' : 's'}`, detail: 'Mark each part Used once it is installed.', mine: actor }
  }
  if (job.identityPending) {
    return { key: 'identify', title: 'Identify the machine', detail: 'Record the real serial and model before it can be marked ready.', mine: actor }
  }
  return { key: 'mark_ready', title: 'Mark ready', detail: 'Repairs done and parts fitted: mark it ready for retest.', mine: actor }
}
