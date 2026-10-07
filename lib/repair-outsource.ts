/** Minimal repair shape needed to decide if outsourcing is allowed. */
type RepairOutsourceCandidate = {
  assignedTechnicianId?: string | null
  repairPath?: 'diagnosis_first' | 'direct_repair' | string | null
  diagnosis?: {
    findings?: string | null
    faultDescription?: string | null
  } | null
}

export function repairHasLoggedDiagnosis(repair: RepairOutsourceCandidate): boolean {
  return !!(repair.diagnosis?.findings?.trim() || repair.diagnosis?.faultDescription?.trim())
}

export function repairIsAssignedForOutsource(repair: RepairOutsourceCandidate): boolean {
  return !!String(repair.assignedTechnicianId || '').trim()
}

/**
 * A linked repair may only be outsourced after a technician is assigned.
 * Diagnosis First also requires a logged diagnosis; Direct Repair does not
 * (that path intentionally bypasses diagnosis).
 */
export function repairOutsourceReadiness(
  repair: RepairOutsourceCandidate,
): { ok: true } | { ok: false; reason: string } {
  if (!repairIsAssignedForOutsource(repair)) {
    return { ok: false, reason: 'Assign a technician before outsourcing this repair' }
  }
  if (repair.repairPath !== 'direct_repair' && !repairHasLoggedDiagnosis(repair)) {
    return { ok: false, reason: 'Log a diagnosis before outsourcing this repair' }
  }
  return { ok: true }
}

const NOT_OUTSOURCEABLE_STATUSES = new Set([
  'delivered', 'cancelled', 'closed', 'declined', 'unrepairable', 'returned',
  'retained', 'ready', 'verified_released', 'collected',
])

/** Repairs worth listing in the outsource picker at all: still open in the workshop. */
export function isOpenForOutsourcePicker(repair: { status?: string | null }): boolean {
  return !NOT_OUTSOURCEABLE_STATUSES.has(String(repair.status ?? '').toLowerCase())
}

/**
 * Why this open repair cannot be sent out right now, or null when it can.
 *
 * The picker used to drop any repair that failed these checks, so the person
 * searched for REP/0312, found nothing, and had no idea why. Listing it with
 * the reason tells them the one thing to do next.
 */
export function outsourcePickBlocker(
  repair: RepairOutsourceCandidate & { id?: string | null },
  jobs: { repairOrderId?: string | null; status?: string | null; ref?: string | null; vendorName?: string | null }[] = [],
): string | null {
  const open = jobs.find(job => job?.repairOrderId === repair.id && job.status === 'sent')
  if (open) {
    const vendor = String(open.vendorName ?? '').replace(/\s*\(.*\)\s*$/, '').trim() || 'a vendor'
    return `Already at ${vendor} via ${open.ref ?? 'an open job'} — mark it returned first`
  }
  const readiness = repairOutsourceReadiness(repair)
  return readiness.ok ? null : readiness.reason
}
