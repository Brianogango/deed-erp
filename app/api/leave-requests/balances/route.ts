import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { isRoleAllowed } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import type { LeaveBalance } from '@/lib/store'

const WRITE_ROLES = ['director', 'admin_officer']

/**
 * PUT /api/leave-requests/balances
 * Body: { balances: LeaveBalance[] }
 * Replaces all stored balances for the affected employees.
 * Used by: initYearBalances, updateLeaveBalance, expireYearEndBalances
 */
export async function PUT(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isRoleAllowed(session.user.role, WRITE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || !Array.isArray(body.balances)) {
    return NextResponse.json({ error: 'Expected { balances: LeaveBalance[] }' }, { status: 400 })
  }

  const updatedBalances: LeaveBalance[] = body.balances
  const state = await loadAppState()
  const existing: LeaveBalance[] = Array.isArray(state['deed_leaveBalances'])
    ? (state['deed_leaveBalances'] as LeaveBalance[])
    : []

  const updatedEmpIds = new Set(updatedBalances.map(b => b.employeeId))
  const merged = [
    ...existing.filter(b => !updatedEmpIds.has(b.employeeId)),
    ...updatedBalances,
  ]

  await saveStoreKeys({ deed_leaveBalances: JSON.stringify(merged) })
  return NextResponse.json({ ok: true, total: merged.length })
}
