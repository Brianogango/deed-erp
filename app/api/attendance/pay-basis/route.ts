import { NextResponse } from 'next/server'
import { requirePermission, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { listPayBasis, setPayBasis } from '@/lib/hr/attendance.server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('managePayroll')
    return NextResponse.json({ payBasis: await listPayBasis() })
  })
}

/** Monthly salary, or paid by the day at a daily rate. */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requirePermission('managePayroll')
    const body = await request.json().catch(() => ({})) as { employeeId?: string; basis?: string; dailyRate?: number }
    const row = await setPayBasis(String(body.employeeId ?? ''), body.basis === 'daily' ? 'daily' : 'monthly', Number(body.dailyRate ?? 0), actor.id)
    await writeFinancialAudit({ userId: actor.id, action: 'attendance.pay_basis_set', entityType: 'employee', entityId: row.employeeId, newValues: row })
    return NextResponse.json({ payBasis: row })
  })
}
