import 'server-only'
import prisma from '@/lib/prisma'
import { EMPLOYEE_LEAVE_TYPES, LEAVE_ENTITLEMENTS, type StoreLeaveType } from '@/lib/leave-utils'

// Prisma is the source of truth for leave. These helpers translate between the
// relational rows and the JSON shapes the client already consumes, so the
// dedicated /api/leave-requests routes can switch persistence without changing
// the client. All leave enum values line up 1:1 with the Prisma LeaveType enum.

export interface ClientLeaveRequest {
  id: string
  ref: string
  employeeId: string
  employeeName: string
  leaveType: StoreLeaveType
  startDate: string
  endDate: string
  days: number
  reason: string
  status: 'pending_hr' | 'approved' | 'rejected' | 'cancelled'
  submittedDate: string
  hrApprovalBy?: string
  hrDecisionDate?: string
  submittedByUserId?: string
  isSystemGenerated?: boolean
}

export interface ClientLeaveBalance {
  id: string
  employeeId: string
  leaveType: StoreLeaveType
  year: number
  entitlement: number
  used: number
  pending: number
  carryForward: number
}

type DbLeaveRequest = {
  id: string; reference: string | null; employeeId: string; employeeName: string | null
  leaveType: string; startDate: Date; endDate: Date; daysRequested: unknown; reason: string | null
  status: string; reviewedByName: string | null; reviewedAt: Date | null
  submittedByUserId: string | null; isSystemGenerated: boolean; createdAt: Date
}

type DbLeaveBalance = {
  id: string; employeeId: string; leaveType: string; year: number
  entitlement: unknown; carryForward: unknown; used: unknown; pending: unknown
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

export function toClientRequest(r: DbLeaveRequest): ClientLeaveRequest {
  return {
    id: r.id,
    ref: r.reference ?? `LV/${r.id.slice(0, 8).toUpperCase()}`,
    employeeId: r.employeeId,
    employeeName: r.employeeName ?? '',
    leaveType: r.leaveType as StoreLeaveType,
    startDate: dateOnly(r.startDate),
    endDate: dateOnly(r.endDate),
    days: num(r.daysRequested),
    reason: r.reason ?? '',
    status: r.status as ClientLeaveRequest['status'],
    submittedDate: r.createdAt.toISOString(),
    hrApprovalBy: r.reviewedByName ?? undefined,
    hrDecisionDate: r.reviewedAt ? r.reviewedAt.toISOString() : undefined,
    submittedByUserId: r.submittedByUserId ?? undefined,
    isSystemGenerated: r.isSystemGenerated || undefined,
  }
}

export function toClientBalance(b: DbLeaveBalance): ClientLeaveBalance {
  return {
    id: b.id,
    employeeId: b.employeeId,
    leaveType: b.leaveType as StoreLeaveType,
    year: b.year,
    entitlement: num(b.entitlement),
    used: num(b.used),
    pending: num(b.pending),
    carryForward: num(b.carryForward),
  }
}

/** Default balances for an employee for a year (used when none exist yet). */
export function defaultBalances(employeeId: string, year: number): ClientLeaveBalance[] {
  return EMPLOYEE_LEAVE_TYPES.map(leaveType => ({
    id: `${employeeId}-${leaveType}-${year}`,
    employeeId,
    leaveType,
    year,
    entitlement: LEAVE_ENTITLEMENTS[leaveType] ?? 0,
    carryForward: 0,
    used: 0,
    pending: 0,
  }))
}

/** Fetch a leave balance row (or a synthesized default) for one employee/type/year. */
export async function getBalance(employeeId: string, leaveType: StoreLeaveType, year: number): Promise<ClientLeaveBalance> {
  const row = await prisma.leaveBalance.findUnique({
    where: { employeeId_leaveType_year: { employeeId, leaveType: leaveType as any, year } },
  }).catch(() => null)
  if (row) return toClientBalance(row as unknown as DbLeaveBalance)
  return {
    id: `${employeeId}-${leaveType}-${year}`,
    employeeId, leaveType, year,
    entitlement: LEAVE_ENTITLEMENTS[leaveType] ?? 0, carryForward: 0, used: 0, pending: 0,
  }
}

/** Upsert a balance and adjust its `pending`/`used` counters by deltas. */
export async function adjustBalance(
  employeeId: string,
  leaveType: StoreLeaveType,
  year: number,
  delta: { pending?: number; used?: number },
): Promise<void> {
  const current = await getBalance(employeeId, leaveType, year)
  const pending = Math.max(0, current.pending + (delta.pending ?? 0))
  const used = Math.max(0, current.used + (delta.used ?? 0))
  await prisma.leaveBalance.upsert({
    where: { employeeId_leaveType_year: { employeeId, leaveType: leaveType as any, year } },
    update: { pending, used },
    create: {
      employeeId, leaveType: leaveType as any, year,
      entitlement: current.entitlement, carryForward: current.carryForward, pending, used,
    },
  })
}
