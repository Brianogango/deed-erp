/**
 * Apply a logged diagnosis onto a repair in one write.
 *
 * The diagnosis modal used to call logDiagnosis and then updateRepair (warranty
 * / client-damage). updateRepair rebuilt the row from a stale snapshot and
 * wiped findings + status, so technicians had to log diagnosis twice before
 * quote/part picking unlocked.
 */

export type DiagnosisLogRepairPatch = {
  clientCausedDamage?: boolean
  clientDamageReason?: string
  underWarranty?: boolean
  warrantyCoverage?: 'full' | 'partial' | 'void'
  warrantyVerificationStatus?: string
}

export function nextStatusAfterDiagnosis(status: string, isRevision: boolean): string {
  if (status === 'assigned' || status === 'received' || !isRevision) return 'diagnosed'
  return status
}

type LoggedDiagnosis = {
  revision?: number
  revisionType?: string
  revisionReason?: string
  findings?: string
  faultDescription?: string
  diagnosedDate: string
}

export function applyLoggedDiagnosis<T extends {
  status: string
  diagnosis?: unknown
  diagnosisHistory?: unknown[]
  statusHistory?: Array<{ status: string; date: string; note?: string; by?: string }>
}>(
  repair: T,
  diagnosis: LoggedDiagnosis,
  extras: DiagnosisLogRepairPatch | undefined,
  diagnosedBy: string,
): T & { diagnosis: LoggedDiagnosis; status: T['status'] } {
  const previousHistory = Array.isArray(repair.diagnosisHistory) && repair.diagnosisHistory.length
    ? repair.diagnosisHistory
    : repair.diagnosis
      ? [repair.diagnosis]
      : []
  const isRevision = previousHistory.length > 0
  const nextStatus = nextStatusAfterDiagnosis(repair.status, isRevision)
  const note = isRevision
    ? `Diagnosis ${diagnosis.revisionType === 'correction' ? 'correction' : 'update'} #${diagnosis.revision}: ${diagnosis.faultDescription ?? ''}`
    : (diagnosis.faultDescription || diagnosis.findings || 'Diagnosis completed')
  const history = repair.statusHistory ?? []
  return {
    ...repair,
    ...extras,
    diagnosis,
    diagnosisHistory: [...previousHistory, diagnosis],
    status: nextStatus as T['status'],
    statusHistory: [
      ...history.filter(h => !(h.status === 'diagnosed' && !isRevision)),
      { status: 'diagnosed', date: diagnosis.diagnosedDate, note, by: diagnosedBy },
    ],
  }
}
