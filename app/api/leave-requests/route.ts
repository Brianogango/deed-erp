import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { writeFinancialAudit } from '@/lib/finance-audit'
import prisma from '@/lib/prisma'
import type { LeaveRequest as StoreLeaveRequest, LeaveBalance } from '@/lib/store'
import { EMPLOYEE_LEAVE_TYPES, LEAVE_ENTITLEMENTS, type StoreLeaveType } from '@/lib/leave-utils'

const HR_ROLES = ['director', 'admin_officer', 'finance_officer', 'technical_lead']

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `lv_${Date.now()}_${Math.random().toString(36).slice(2)}`)

function defaultBalancesForEmployee(employeeId: string, year = new Date().getFullYear()): LeaveBalance[] {
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

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const state = await loadAppState()
    const requests: StoreLeaveRequest[] = Array.isArray(state['deed_leaveRequests'])
      ? (state['deed_leaveRequests'] as StoreLeaveRequest[])
      : []
    const balances: LeaveBalance[] = Array.isArray(state['deed_leaveBalances'])
      ? (state['deed_leaveBalances'] as LeaveBalance[])
      : []

    if (HR_ROLES.includes(session.user.role)) {
      return NextResponse.json({ requests, balances })
    }

    // Non-HR: only own requests and own balances. Resolve employee linkage even
    // before the user has submitted their first leave request.
    const employee = await prisma.employee.findFirst({
      where: { user: { id: session.user.id } },
      select: { id: true },
    }).catch(() => null)
    const myRequests = requests.filter(r =>
      r.submittedByUserId === session.user.id ||
      (!!employee?.id && r.employeeId === employee.id)
    )
    const myEmpIds = new Set([
      ...myRequests.map(r => r.employeeId),
      ...(employee?.id ? [employee.id] : []),
    ])
    const year = new Date().getFullYear()
    const existingBalances = balances.filter(b => myEmpIds.has(b.employeeId))
    const myBalances = employee?.id
      ? [
          ...existingBalances,
          ...defaultBalancesForEmployee(employee.id, year).filter(def =>
            !existingBalances.some(b => b.employeeId === def.employeeId && b.leaveType === def.leaveType && b.year === def.year)
          ),
        ]
      : existingBalances
    return NextResponse.json({ requests: myRequests, balances: myBalances })
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const isHr = isRoleAllowed(session.user.role, HR_ROLES)
    const body = await request.json()
    const state = await loadAppState()

    const requests: StoreLeaveRequest[] = Array.isArray(state['deed_leaveRequests'])
      ? (state['deed_leaveRequests'] as StoreLeaveRequest[])
      : []
    const balances: LeaveBalance[] = Array.isArray(state['deed_leaveBalances'])
      ? (state['deed_leaveBalances'] as LeaveBalance[])
      : []

    // ── HR path ───────────────────────────────────────────────────────────────
    // HR approvers may submit bulk requests (e.g. December closure) and adjust
    // balances directly. Everything is trusted only because the role is gated.
    if (isHr) {
      const newRequests: StoreLeaveRequest[] = body.bulkRequests ?? [body]
      const updatedBalances: LeaveBalance[] = body.balances ?? []
      const existingIds = new Set(requests.map(r => r.id))
      const toAdd = newRequests.filter(r => !existingIds.has(r.id))
      const mergedRequests = [...toAdd, ...requests]
      let mergedBalances = balances
      if (updatedBalances.length > 0) {
        const updatedEmpIds = new Set(updatedBalances.map(b => b.employeeId))
        mergedBalances = [...balances.filter(b => !updatedEmpIds.has(b.employeeId)), ...updatedBalances]
      }
      await saveStoreKeys({
        deed_leaveRequests: JSON.stringify(mergedRequests),
        deed_leaveBalances: JSON.stringify(mergedBalances),
      })
      await writeFinancialAudit({ userId: session.user.id, action: 'hr_leave_bulk_write', entityType: 'leave_request', newValues: { added: toAdd.length, balancesUpdated: updatedBalances.length } })
      return NextResponse.json({ ok: true, added: toAdd.length })
    }

    // ── Self-service path ───────────────────────────────────────────────────────
    // A regular employee may only file leave for THEMSELVES, always as pending,
    // and may never write balances or bulk requests or set an approved status.
    if (body.bulkRequests || body.balances) {
      return NextResponse.json({ error: 'Not permitted to submit bulk requests or balance changes' }, { status: 403 })
    }

    const employee = await prisma.employee.findFirst({
      where: { user: { id: session.user.id } },
      select: { id: true, firstName: true, lastName: true },
    }).catch(() => null)
    if (!employee?.id) {
      return NextResponse.json({ error: 'No employee profile is linked to your account. Contact HR.' }, { status: 403 })
    }

    const leaveType = String(body.leaveType ?? '') as StoreLeaveType
    if (!EMPLOYEE_LEAVE_TYPES.includes(leaveType)) {
      return NextResponse.json({ error: 'Invalid leave type' }, { status: 422 })
    }
    const days = Number(body.days)
    if (!Number.isFinite(days) || days <= 0) {
      return NextResponse.json({ error: 'Leave days must be greater than zero' }, { status: 422 })
    }
    if (!body.startDate || !body.endDate) {
      return NextResponse.json({ error: 'Start and end dates are required' }, { status: 422 })
    }

    // Server-side balance guard: block requests that exceed the remaining
    // entitlement (entitlement + carryForward − used − pending) for this type.
    const year = new Date(body.startDate).getFullYear()
    const bal = balances.find(b => b.employeeId === employee.id && b.leaveType === leaveType && b.year === year)
    const entitlement = bal?.entitlement ?? LEAVE_ENTITLEMENTS[leaveType] ?? 0
    const remaining = entitlement + (bal?.carryForward ?? 0) - (bal?.used ?? 0) - (bal?.pending ?? 0)
    // Unpaid/compassionate style types with no entitlement are allowed through
    // (they are tracked but not capped); entitled types are capped.
    if (entitlement > 0 && days > remaining) {
      return NextResponse.json({ error: `Insufficient ${leaveType} balance: ${remaining} day(s) remaining` }, { status: 422 })
    }

    const employeeName = `${employee.firstName} ${employee.lastName}`.trim()
    const newRequest: StoreLeaveRequest = {
      id: typeof body.id === 'string' && body.id ? body.id : uid(),
      ref: typeof body.ref === 'string' && body.ref ? body.ref : `LV/${Date.now().toString(36).toUpperCase()}`,
      employeeId: employee.id,
      employeeName,
      leaveType,
      startDate: String(body.startDate),
      endDate: String(body.endDate),
      days,
      reason: String(body.reason ?? ''),
      status: 'pending_hr',
      submittedDate: new Date().toISOString(),
      submittedByUserId: session.user.id,
    }

    // Reflect the request as pending against the balance so remaining is accurate.
    let mergedBalances = balances
    if (bal) {
      mergedBalances = balances.map(b => b === bal ? { ...b, pending: (b.pending ?? 0) + days } : b)
    }

    await saveStoreKeys({
      deed_leaveRequests: JSON.stringify([newRequest, ...requests]),
      deed_leaveBalances: JSON.stringify(mergedBalances),
    })
    await writeFinancialAudit({ userId: session.user.id, action: 'apply_leave', entityType: 'leave_request', entityId: newRequest.id, newValues: { leaveType, days, employeeId: employee.id } })

    return NextResponse.json({ ok: true, added: 1, request: newRequest })
  })
}
