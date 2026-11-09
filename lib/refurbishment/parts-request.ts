/**
 * Refurbishment parts in the same parts-request queue as repairs
 * (lib/repair/parts-request.ts). A refurb part the warehouse could not supply
 * is "requested"; the desk corrects the count or raises a purchase order
 * linked to the job and part; receiving that order marks the part received
 * and tells the technician. The job never stops for it — only "Mark ready"
 * waits for its parts.
 *
 * One request per part (the part's id is the request id). This adapter maps a
 * part to the shared request shape and back, so the queue, the count check
 * and the order rules are the repair ones, unchanged.
 *
 * Pure.
 */
import type { PartsRequest, RepairForParts } from '@/lib/repair/parts-request'

export type RefurbPartForQueue = {
  id: string
  partName: string
  productId?: string
  qty: number
  estimatedCost: number
  status: string
  requestedDate?: string
  requestedByName?: string
  poId?: string
  poRef?: string
  orderedDate?: string
  receivedDate?: string
  notifiedTechDate?: string
  adjustmentRefs?: string[]
  countCheckedProductIds?: string[]
}

export type RefurbJobForQueue = {
  id: string
  ref: string
  status: string
  productName: string
  intakeDate?: string
  assignedTechnicianName?: string
  partsNeeded: RefurbPartForQueue[]
}

const CLOSED_JOB = new Set(['transferred', 'written_off'])

/** The part as a parts request; null when nothing is waiting on the desk. */
export function refurbPartRequest(job: RefurbJobForQueue, part: RefurbPartForQueue): PartsRequest | null {
  if (part.status !== 'requested' && part.status !== 'ordered') return null
  return {
    id: part.id,
    repairId: job.id,
    repairRef: job.ref,
    requestedBy: '',
    requestedByName: part.requestedByName || job.assignedTechnicianName || 'Technician',
    requestedDate: part.requestedDate || job.intakeDate || '',
    urgency: 'normal',
    status: part.status === 'ordered' ? 'ordered' : 'pending',
    notes: '',
    items: [{
      type: 'part',
      productId: part.productId ?? '',
      productName: part.partName,
      description: part.partName,
      qty: String(part.qty),
      estimatedCost: String(part.estimatedCost ?? 0),
      supplier: '',
    }],
    adjustmentRefs: part.adjustmentRefs,
    countCheckedProductIds: part.countCheckedProductIds,
    purchaseOrderId: part.poId,
    orderReference: part.poRef,
    orderedDate: part.orderedDate,
  }
}

/** Open refurbishment jobs in the queue's shape, tagged so the desk's actions reach the right record. */
export function refurbJobsForPartsQueue(jobs: RefurbJobForQueue[]): Array<RepairForParts & { kind: 'refurb' }> {
  return jobs
    .filter(j => !CLOSED_JOB.has(j.status))
    .map(j => ({
      kind: 'refurb' as const,
      id: j.id,
      ref: j.ref,
      status: j.status,
      productName: j.productName,
      customerName: '',
      procurementRequests: j.partsNeeded.map(p => refurbPartRequest(j, p)).filter((r): r is PartsRequest => !!r),
    }))
    .filter(j => j.procurementRequests.length > 0)
}

/** What the desk did to the request, written back onto the part. */
export function refurbPartAfterRequest<P extends RefurbPartForQueue>(part: P, request: PartsRequest): P {
  const productId = request.items[0]?.productId
  return {
    ...part,
    ...(productId ? { productId } : {}),
    ...(request.status === 'ordered' ? { status: 'ordered' } : {}),
    ...(request.purchaseOrderId ? { poId: request.purchaseOrderId, poRef: request.orderReference, orderedDate: request.orderedDate } : {}),
    ...(request.adjustmentRefs ? { adjustmentRefs: request.adjustmentRefs } : {}),
    ...(request.countCheckedProductIds ? { countCheckedProductIds: request.countCheckedProductIds } : {}),
  } as P
}

/** The purchase order's note: which job and part, so the GRN clerk knows. */
export function refurbPartsOrderNote(job: Pick<RefurbJobForQueue, 'ref' | 'productName'>, part: Pick<RefurbPartForQueue, 'partName'>): string {
  return `Part for refurbishment ${job.ref} — ${part.partName} for ${job.productName}. Receiving this order tells the technician it is in.`
}

/**
 * A purchase order for a refurb part was received: the part is in (still in
 * the warehouse — it comes out when the technician marks it used). Returns
 * null when no ordered part waits on this order.
 */
export function refurbPartsReceivedOnOrder<J extends RefurbJobForQueue>(
  jobs: J[],
  poId: string,
  when: string,
): { jobs: J[]; job: J; parts: RefurbPartForQueue[] } | null {
  let hit: { job: J; parts: RefurbPartForQueue[] } | null = null
  const next = jobs.map(job => {
    if (CLOSED_JOB.has(job.status)) return job
    const parts = job.partsNeeded.filter(p => p.poId === poId && p.status === 'ordered')
    if (!parts.length) return job
    const updated = {
      ...job,
      partsNeeded: job.partsNeeded.map(p => (parts.includes(p) ? { ...p, status: 'received', receivedDate: when, notifiedTechDate: when } : p)),
    } as J
    hit = { job: updated, parts }
    return updated
  })
  if (!hit) return null
  const found = hit as { job: J; parts: RefurbPartForQueue[] }
  return { jobs: next, job: found.job, parts: found.parts }
}
