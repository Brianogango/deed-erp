import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { LeaveRequest as StoreLeaveRequest, LeaveBalance } from '@/lib/store'

const HR_ROLES = ['director', 'admin_officer']

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

    // Non-HR: only own requests and own balances
    const myRequests = requests.filter(r => r.submittedByUserId === session.user.id)
    const myEmpIds = new Set(myRequests.map(r => r.employeeId))
    const myBalances = balances.filter(b => myEmpIds.has(b.employeeId))
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
