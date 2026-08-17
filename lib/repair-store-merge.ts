/**
 * Merge `deed_repairs_v2` blob writes by id.
 *
 * The operational ledger is a whole-array JSON blob. A stale tab (or a
 * technician slice upsert) used to *replace* that array and rewind jobs that
 * had already been finalised. Union-by-id so rows cannot disappear, and never
 * let a later sync take a finalised / terminal job backwards.
 *
 * In-progress Back / QC-fail still persist: those statuses are not pinned.
 * The one documented finalised rewind is ORC void: verified_released → ready.
 */

import { REPAIR_PROGRESS_ORDER } from '@/lib/repair-progress'

export type RepairStoreRow = {
  id?: unknown
  ref?: unknown
  status?: unknown
  [key: string]: unknown
}

export const REPAIR_TERMINAL_STATUSES = new Set<string>([
  'cancelled',
  'declined',
  'unrepairable',
  'returned',
  'retained',
])

/** Jobs that have left the workshop floor — a stale tab must not rewind these. */
export const REPAIR_FINALIZED_STATUSES = new Set<string>([
  'ready',
  'invoiced',
  'verified_released',
  'delivered',
  'collected',
  'closed',
])

const COMPLETION_KEYS = [
  'invoiceId',
  'linkedInvoiceId',
  'invoiceDate',
  'deliveryActualDate',
  'collectedDate',
  'closedDate',
  'qcPassedDate',
  'qcApprovedBy',
  'repairCompletedDate',
  'quote',
  'diagnosis',
  'diagnosisHistory',
  'partsUsed',
  'conditionOnRelease',
  'deliveryRecipient',
  'deliveryRecipientPhone',
] as const

function asId(row: RepairStoreRow): string | null {
  if (row?.id == null) return null
  const s = String(row.id).trim()
  return s || null
}

function asStatus(row: RepairStoreRow | undefined): string {
  return String(row?.status ?? '').trim()
}

export function repairStatusRank(status: unknown): number {
  const s = String(status ?? '').trim()
  if (REPAIR_TERMINAL_STATUSES.has(s)) return 1_000
  const idx = REPAIR_PROGRESS_ORDER.indexOf(s as (typeof REPAIR_PROGRESS_ORDER)[number])
  return idx
}

function isPresent(value: unknown): boolean {
  if (value == null) return false
  if (value === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

/**
 * Keep the chosen row's status, but copy completion fields the winner is
 * missing so a forward write cannot drop an invoice / ORC / collection stamp.
 */
export function preserveRepairCompletionFields(
  primary: RepairStoreRow,
  secondary: RepairStoreRow | undefined,
): RepairStoreRow {
  if (!secondary) return primary
  const next: RepairStoreRow = { ...secondary, ...primary, status: primary.status }
  for (const key of COMPLETION_KEYS) {
    if (!isPresent(primary[key]) && isPresent(secondary[key])) {
      next[key] = secondary[key]
    }
  }
  const primaryHistory = Array.isArray(primary.statusHistory) ? primary.statusHistory : []
  const secondaryHistory = Array.isArray(secondary.statusHistory) ? secondary.statusHistory : []
  if (secondaryHistory.length > primaryHistory.length) {
    next.statusHistory = secondaryHistory
  }
  return next
}

function isOrcVoidRewind(currentStatus: string, incomingStatus: string): boolean {
  return currentStatus === 'verified_released' && incomingStatus === 'ready'
}

export function pickRepairStoreRow(
  current: RepairStoreRow | undefined,
  incoming: RepairStoreRow,
): RepairStoreRow {
  if (!current) return incoming

  const currentStatus = asStatus(current)
  const incomingStatus = asStatus(incoming)

  if (isOrcVoidRewind(currentStatus, incomingStatus)) {
    return preserveRepairCompletionFields(incoming, current)
  }

  if (REPAIR_TERMINAL_STATUSES.has(currentStatus) && incomingStatus !== currentStatus) {
    return preserveRepairCompletionFields(current, incoming)
  }

  const currentRank = repairStatusRank(currentStatus)
  const incomingRank = repairStatusRank(incomingStatus)

  if (REPAIR_FINALIZED_STATUSES.has(currentStatus) && incomingRank < currentRank) {
    return preserveRepairCompletionFields(current, incoming)
  }

  return preserveRepairCompletionFields(incoming, current)
}

export function mergeRepairsStoreWrite(current: unknown, incoming: unknown): RepairStoreRow[] {
  const currentArr: RepairStoreRow[] = Array.isArray(current) ? current : []
  const incomingArr: RepairStoreRow[] = Array.isArray(incoming) ? incoming : []
  if (incomingArr.length === 0) return currentArr

  const byId = new Map<string, RepairStoreRow>()
  for (const row of currentArr) {
    const id = asId(row)
    if (id) byId.set(id, row)
  }
  for (const row of incomingArr) {
    const id = asId(row)
    if (!id) continue
    const prev = byId.get(id)
    byId.set(id, pickRepairStoreRow(prev, row))
  }
  return [...byId.values()]
}
