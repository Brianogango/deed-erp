/**
 * Repair workflow path helpers.
 *
 * `repairPath` lives on the `deed_repairs_v2` JSON blob only (not a Prisma column).
 * Missing / unknown values are treated as diagnosis-first.
 */

export type RepairWorkflowPath = 'diagnosis_first' | 'direct_repair'

export const DIRECT_REPAIR_WAIVER_TEXT =
  'I authorise Deed to proceed with direct repair work and acknowledge that customer-caused damage, liquid damage, previous tampering, or unavailable parts may affect warranty coverage and repair outcome.'

export function normalizeRepairPath(value: unknown): RepairWorkflowPath {
  return value === 'direct_repair' ? 'direct_repair' : 'diagnosis_first'
}

export function isDirectRepairPath(value: unknown): boolean {
  return normalizeRepairPath(value) === 'direct_repair'
}

export function repairPathLabel(value: unknown): string {
  return isDirectRepairPath(value) ? 'Direct Repair' : 'Diagnosis First'
}

/**
 * Soft-terminal: customer declined this quote, but the job can still be
 * re-quoted or the device returned (not a permanent close).
 */
export function isQuoteDeclinedReopenable(status: unknown): boolean {
  return status === 'declined'
}

/** Statuses where a quote may be generated/edited. */
export function quotableStatusesForPath(path: unknown): string[] {
  // `declined` is intentionally included — staff may revise and re-send after
  // the customer rejects a quote (cheaper scope, fewer parts, etc.).
  const base = ['diagnosed', 'awaiting_approval', 'approved', 'awaiting_parts', 'in_repair', 'qc', 'declined']
  return isDirectRepairPath(path) ? ['assigned', ...base] : base
}

/** Statuses from which an unrepaired device may be returned to the customer. */
export function returnableStatusesForPath(_path?: unknown): string[] {
  return [
    'received',
    'assigned',
    'diagnosed',
    'awaiting_approval',
    'approved',
    'awaiting_parts',
    'in_repair',
    'qc',
    'declined',
    'unrepairable',
  ]
}

/** Statuses from which the assigned tech may start work. */
export function startableStatusesForPath(path: unknown): string[] {
  if (isDirectRepairPath(path)) {
    return ['assigned', 'diagnosed', 'approved', 'awaiting_parts']
  }
  return ['approved', 'awaiting_parts']
}
