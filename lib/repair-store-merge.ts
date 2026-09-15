/**
 * Merge `deed_repairs_v2` blob writes by id.
 *
 * The operational ledger is a whole-array JSON blob. A stale tab (or a
 * technician slice upsert) used to *replace* that array and rewind jobs that
 * had already been finalised — and also rewind in-progress jobs back to
 * received/diagnosed. Union-by-id so rows cannot disappear.
 *
 * Finalised / terminal jobs never rewind. In-progress Back / QC-fail still
 * persist when they touch a single job. If one write would rewind two or more
 * in-progress statuses, it is treated as a stale snapshot and those rows are
 * pinned. Booked dates (intakeDate / createdDate / date) on a finished job
 * stay put, except a same month-day year correction of an out-of-bounds
 * booking (2091-04-28 → 2026-04-28). The one documented finalised rewind is
 * ORC void: verified_released → ready.
 */

import { repairDateBoundsError } from '@/lib/data-validation'
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
  'billingExempt',
  'billingExemptReason',
  'billingExemptNotes',
  'billingExemptBy',
  'billingExemptAt',
] as const

const QUOTE_SKIP_STATUSES = new Set(['diagnosed', 'awaiting_approval', 'declined'])

const BILLING_EXEMPT_KEYS = [
  'billingExempt',
  'billingExemptReason',
  'billingExemptNotes',
  'billingExemptBy',
  'billingExemptAt',
] as const

/**
 * No-charge is blob/payload-only. A Prisma snapshot taken before the mark
 * must not restore Create Invoice / Update Quote on the next hydrate.
 *
 * Generic overloads keep domain DTOs (such as RepairOrder) type-safe without
 * requiring them to expose the index signature used by the blob merge layer.
 */
export function overlayRepairNoCharge<T extends object, U extends object>(
  primary: T,
  secondary: U | undefined,
): T
export function overlayRepairNoCharge(
  primary: object,
  secondary: object | undefined,
): object {
  const primaryRow = primary as RepairStoreRow
  const secondaryRow = secondary as RepairStoreRow | undefined
  if (!secondaryRow || secondaryRow.billingExempt !== true) return primary
  const next: RepairStoreRow = primaryRow.billingExempt === true
    ? { ...primaryRow }
    : { ...primaryRow, billingExempt: true }
  if (primaryRow.billingExempt !== true) {
    for (const key of BILLING_EXEMPT_KEYS) {
      if (isPresent(secondaryRow[key])) next[key] = secondaryRow[key]
    }
  }
  if (QUOTE_SKIP_STATUSES.has(asStatus(next)) && asStatus(secondaryRow) === 'approved') {
    next.status = 'approved'
  }
  return next
}

export function overlayRepairNoChargeFromBlob<T extends object, U extends object>(
  rows: T[],
  blob: U[],
): T[]
export function overlayRepairNoChargeFromBlob(
  rows: object[],
  blob: object[],
): object[] {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(blob) || blob.length === 0) {
    return rows
  }
  const byId = new Map<string, RepairStoreRow>()
  const byRef = new Map<string, RepairStoreRow>()
  for (const item of blob) {
    const row = item as RepairStoreRow
    const id = asId(row)
    if (id) byId.set(id, row)
    const ref = String(row.ref ?? '').trim()
    if (ref) byRef.set(ref, row)
  }
  return rows.map(item => {
    const row = item as RepairStoreRow
    const id = asId(row)
    const ref = String(row.ref ?? '').trim()
    const secondary = (id ? byId.get(id) : undefined) ?? (ref ? byRef.get(ref) : undefined)
    return overlayRepairNoCharge(row, secondary)
  })
}

/** Booked timestamps — a stale tab must not rewrite the year on a finished job. */
const BOOKING_KEYS = ['intakeDate', 'createdDate', 'date'] as const

function isOutOfBoundsBooking(value: unknown): boolean {
  return isPresent(value) && repairDateBoundsError(value) != null
}

function calendarMonthDay(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{4})-(\d{2}-\d{2})/)
  return match ? match[2] : null
}

/**
 * Keep the booked calendar date on a finalised/terminal job.
 * The one allowed rewrite is a same month-day year correction
 * (2091-04-28 → 2026-04-28) when the current year is out of bounds.
 */
export function preserveRepairBookingFields(
  picked: RepairStoreRow,
  current: RepairStoreRow | undefined,
  incoming: RepairStoreRow,
): RepairStoreRow {
  if (!current) return picked
  const currentStatus = asStatus(current)
  if (!REPAIR_TERMINAL_STATUSES.has(currentStatus) && !REPAIR_FINALIZED_STATUSES.has(currentStatus)) {
    return picked
  }
  const next: RepairStoreRow = { ...picked }
  for (const key of BOOKING_KEYS) {
    const cur = current[key]
    const inc = incoming[key]
    if (!isPresent(cur)) continue
    const yearCorrection =
      isOutOfBoundsBooking(cur)
      && isPresent(inc)
      && !isOutOfBoundsBooking(inc)
      && calendarMonthDay(cur) != null
      && calendarMonthDay(cur) === calendarMonthDay(inc)
    next[key] = yearCorrection ? inc : cur
  }
  return next
}

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

export type PickRepairStoreRowOptions = {
  /** Pin in-progress status when a stale snapshot rewinds many jobs at once. */
  pinInProgressRewind?: boolean
}

export function isInProgressStatusRewind(
  current: RepairStoreRow | undefined,
  incoming: RepairStoreRow,
): boolean {
  if (!current) return false
  const currentStatus = asStatus(current)
  const incomingStatus = asStatus(incoming)
  if (!currentStatus || currentStatus === incomingStatus) return false
  if (isOrcVoidRewind(currentStatus, incomingStatus)) return false
  if (REPAIR_TERMINAL_STATUSES.has(currentStatus) || REPAIR_FINALIZED_STATUSES.has(currentStatus)) {
    return false
  }
  return repairStatusRank(incomingStatus) < repairStatusRank(currentStatus)
}

export function pickRepairStoreRow(
  current: RepairStoreRow | undefined,
  incoming: RepairStoreRow,
  options: PickRepairStoreRowOptions = {},
): RepairStoreRow {
  if (!current) return incoming

  const currentStatus = asStatus(current)
  const incomingStatus = asStatus(incoming)

  if (isOrcVoidRewind(currentStatus, incomingStatus)) {
    return overlayRepairNoCharge(
      preserveRepairBookingFields(preserveRepairCompletionFields(incoming, current), current, incoming),
      current,
    )
  }

  if (REPAIR_TERMINAL_STATUSES.has(currentStatus) && incomingStatus !== currentStatus) {
    return overlayRepairNoCharge(
      preserveRepairBookingFields(preserveRepairCompletionFields(current, incoming), current, incoming),
      current,
    )
  }

  const currentRank = repairStatusRank(currentStatus)
  const incomingRank = repairStatusRank(incomingStatus)

  if (REPAIR_FINALIZED_STATUSES.has(currentStatus) && incomingRank < currentRank) {
    return overlayRepairNoCharge(
      preserveRepairBookingFields(preserveRepairCompletionFields(current, incoming), current, incoming),
      current,
    )
  }

  if (options.pinInProgressRewind && isInProgressStatusRewind(current, incoming)) {
    return overlayRepairNoCharge(
      preserveRepairBookingFields(preserveRepairCompletionFields(current, incoming), current, incoming),
      current,
    )
  }

  return overlayRepairNoCharge(
    preserveRepairBookingFields(preserveRepairCompletionFields(incoming, current), current, incoming),
    current,
  )
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

  let inProgressRewinds = 0
  for (const row of incomingArr) {
    const id = asId(row)
    if (!id) continue
    if (isInProgressStatusRewind(byId.get(id), row)) inProgressRewinds += 1
  }
  const pinInProgressRewind = inProgressRewinds >= 2

  for (const row of incomingArr) {
    const id = asId(row)
    if (!id) continue
    const prev = byId.get(id)
    byId.set(id, pickRepairStoreRow(prev, row, { pinInProgressRewind }))
  }
  return [...byId.values()]
}
