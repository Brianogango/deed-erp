/** Minimal repair shape needed to decide if outsourcing is allowed. */
export type RepairOutsourceCandidate = {
  assignedTechnicianId?: string | null
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
 * A linked repair may only be outsourced after a technician is assigned
 * and a diagnosis has been logged.
 */
export function repairOutsourceReadiness(
  repair: RepairOutsourceCandidate,
): { ok: true } | { ok: false; reason: string } {
  if (!repairIsAssignedForOutsource(repair)) {
    return { ok: false, reason: 'Assign a technician before outsourcing this repair' }
  }
  if (!repairHasLoggedDiagnosis(repair)) {
    return { ok: false, reason: 'Log a diagnosis before outsourcing this repair' }
  }
  return { ok: true }
}
