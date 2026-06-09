import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { LeaveRequest, LeaveBalance } from '@/lib/store'

const HR_ROLES = ['director', 'admin_officer']

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const state = await loadAppState()
  const allRequests: LeaveRequest[] = Array.isArray(state['deed_leaveRequests']) ? state['deed_leaveRequests'] as LeaveRequest[] : []
  const allBalances: LeaveBalance[] = Array.isArray(state['deed_leaveBalances']) ? state['deed_leaveBalances'] as LeaveBalance[] : []

  // HR managers see all requests and balances for approvals/reporting
  if (HR_ROLES.includes(session.user.role)) {
    return NextResponse.json({ requests: allRequests, balances: allBalances })
  }

  // Everyone else sees only their own leave data
  const myRequests = allRequests.filter(r => r.submittedByUserId === session.user.id)
  const myEmployeeIds = new Set(myRequests.map(r => r.employeeId))
  const myBalances = allBalances.filter(b => myEmployeeIds.has(b.employeeId))
  return NextResponse.json({ requests: myRequests, balances: myBalances })
}

export async function POST(request: Request) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const state = await loadAppState()
  const requests: LeaveRequest[] = Array.isArray(state['deed_leaveRequests']) ? state['deed_leaveRequests'] as LeaveRequest[] : []
  requests.unshift(body as LeaveRequest)
  await saveStoreKeys({ deed_leaveRequests: JSON.stringify(requests) })
  return NextResponse.json({ ok: true })
}
