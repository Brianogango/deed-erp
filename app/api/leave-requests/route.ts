import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import prisma from '@/lib/prisma'
import type { LeaveRequest as StoreLeaveRequest, LeaveBalance } from '@/lib/store'
import { EMPLOYEE_LEAVE_TYPES, LEAVE_ENTITLEMENTS } from '@/lib/leave-utils'

const HR_ROLES = ['director', 'admin_officer', 'finance_officer', 'technical_lead']

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
    await getRequiredSession()
    const body = await request.json()
    const state = await loadAppState()

    const requests: StoreLeaveRequest[] = Array.isArray(state['deed_leaveRequests'])
      ? (state['deed_leaveRequests'] as StoreLeaveRequest[])
      : []
    const balances: LeaveBalance[] = Array.isArray(state['deed_leaveBalances'])
      ? (state['deed_leaveBalances'] as LeaveBalance[])
      : []

    // Support single request or bulk (e.g. December closure)
    const newRequests: StoreLeaveRequest[] = body.bulkRequests ?? [body]
    const updatedBalances: LeaveBalance[] = body.balances ?? []

    // Prepend new requests, skip duplicates by id
    const existingIds = new Set(requests.map(r => r.id))
    const toAdd = newRequests.filter(r => !existingIds.has(r.id))
    const mergedRequests = [...toAdd, ...requests]

    // Merge updated balances: replace all balances for affected employees
    let mergedBalances = balances
    if (updatedBalances.length > 0) {
      const updatedEmpIds = new Set(updatedBalances.map(b => b.employeeId))
      mergedBalances = [
        ...balances.filter(b => !updatedEmpIds.has(b.employeeId)),
        ...updatedBalances,
      ]
    }

    await saveStoreKeys({
      deed_leaveRequests: JSON.stringify(mergedRequests),
      deed_leaveBalances: JSON.stringify(mergedBalances),
    })

    return NextResponse.json({ ok: true, added: toAdd.length })
  })
}
