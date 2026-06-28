import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { LeaveBalance } from '@/lib/store'

const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'technical_lead']

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const state = await loadAppState()
  const requests: any[] = Array.isArray(state['deed_leaveRequests'])
    ? (state['deed_leaveRequests'] as any[])
    : []
  const balances: LeaveBalance[] = Array.isArray(state['deed_leaveBalances'])
    ? (state['deed_leaveBalances'] as LeaveBalance[])
    : []

  // Update the request record
  const requestData = body.request ?? body
  const idx = requests.findIndex(r => r.id === params.id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  requests[idx] = { ...requests[idx], ...requestData, id: params.id }

  // Merge updated balances if provided
  const updatedBalances: LeaveBalance[] = body.balances ?? []
  let mergedBalances = balances
  if (updatedBalances.length > 0) {
    const updatedEmpIds = new Set(updatedBalances.map(b => b.employeeId))
    mergedBalances = [
      ...balances.filter(b => !updatedEmpIds.has(b.employeeId)),
      ...updatedBalances,
    ]
  }

  await saveStoreKeys({
    deed_leaveRequests: JSON.stringify(requests),
    deed_leaveBalances: JSON.stringify(mergedBalances),
  })

  return NextResponse.json({ item: requests[idx] })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const state = await loadAppState()
  const requests: any[] = Array.isArray(state['deed_leaveRequests'])
    ? (state['deed_leaveRequests'] as any[])
    : []
  const filtered = requests.filter(r => r.id !== params.id)
  await saveStoreKeys({ deed_leaveRequests: JSON.stringify(filtered) })
  return NextResponse.json({ ok: true })
}
