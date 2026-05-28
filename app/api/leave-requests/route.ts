import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { LeaveRequest, LeaveBalance } from '@/lib/store'

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const state = await loadAppState()
  const requests: LeaveRequest[] = Array.isArray(state['deed_leaveRequests']) ? state['deed_leaveRequests'] as LeaveRequest[] : []
  const balances: LeaveBalance[] = Array.isArray(state['deed_leaveBalances']) ? state['deed_leaveBalances'] as LeaveBalance[] : []
  return NextResponse.json({ requests, balances })
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
