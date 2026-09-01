import type { RepairStatus } from '@/lib/repair-types'

/**
 * Jobs that have left the open workshop queue (Dashboard "Open Repairs").
 * 'collected' / 'verified_released' / 'returned' / 'retained' are terminal too —
 * the device has permanently left the shop; without them the Dashboard counted
 * 51+ finished jobs as open while the Repairs module showed ~10 needing action.
 * 'declined' and 'unrepairable' stay open: both still need a decision
 * (revise the quote / arrange device return).
 */
export const CLOSED_REPAIR_STATUSES = ['closed', 'cancelled', 'delivered', 'invoiced', 'collected', 'verified_released', 'returned', 'retained'] as const

export function isOpenRepairJob(repair: { status?: string } | null | undefined): boolean {
  const status = String(repair?.status ?? '')
  return !CLOSED_REPAIR_STATUSES.includes(status as (typeof CLOSED_REPAIR_STATUSES)[number])
}

export const REPAIR_PROGRESS_ORDER: RepairStatus[] = [
  'pending_verification',
  'received',
  'assigned',
  'diagnosed',
  'awaiting_approval',
  'approved',
  'awaiting_parts',
  'in_repair',
  'qc',
  'ready',
  'invoiced',
  'verified_released',
  'delivered',
  'collected',
  'closed',
]

export type RepairProgressCandidate = {
  status: RepairStatus | string
  repairPath?: 'diagnosis_first' | 'direct_repair' | string | null
  procurementRequests?: unknown[] | null
}

/**
 * Progress stages that apply to this repair. Skips diagnosis/approval on
 * direct_repair, and skips awaiting_parts when no procurement was requested.
 */
export function repairProgressOrderFor(repair: RepairProgressCandidate): RepairStatus[] {
  const isDirect = repair.repairPath === 'direct_repair'
  const hasProcurement = (repair.procurementRequests?.length ?? 0) > 0
  return REPAIR_PROGRESS_ORDER.filter(status => {
    // Direct Repair jumps assigned → in_repair (optional quote is auto-approved
    // without visiting awaiting_approval / approved in the linear stepper).
    if (isDirect && (status === 'diagnosed' || status === 'awaiting_approval' || status === 'approved')) {
      return false
    }
    if (!hasProcurement && status === 'awaiting_parts') return false
    return true
  })
}

/**
 * Previous progress step for Back step.
 * Uses the path-aware linear order only — do NOT walk statusHistory.
 * History-based rewind ping-pongs after a back-step (…diagnosed, assigned →
 * next Back returns diagnosed again).
 */
export function getPreviousRepairProgressStatus(repair: RepairProgressCandidate): RepairStatus | null {
  const order = repairProgressOrderFor(repair)
  const current = repair.status as RepairStatus
  const currentIndex = order.indexOf(current)
  if (currentIndex > 0) return order[currentIndex - 1]

  // Current status may have been skipped for this path (e.g. direct_repair
  // landed on diagnosed via the old linear map). Step to the nearest earlier
  // status that still exists on this path.
  const fullIndex = REPAIR_PROGRESS_ORDER.indexOf(current)
  if (fullIndex <= 0) return null
  for (let i = fullIndex - 1; i >= 0; i--) {
    const candidate = REPAIR_PROGRESS_ORDER[i]
    if (order.includes(candidate)) return candidate
  }
  return null
}
