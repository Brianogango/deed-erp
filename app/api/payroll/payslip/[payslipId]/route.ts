import { userCan } from '@/lib/auth/can'
import { NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

import { loadPayslipDetail } from '@/lib/hr/payroll-reports.server'

export const dynamic = 'force-dynamic'

/** Full payslip breakdown. HR/finance see any; an employee sees only their own published payslip. */
export async function GET(_request: Request, { params }: { params: Promise<{ payslipId: string }> }) {
  const { payslipId } = await params
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    const detail = await loadPayslipDetail(payslipId)
    if (!detail) return NextResponse.json({ error: 'Payslip not found' }, { status: 404 })
    const privileged = userCan(user, 'managePayroll')
    const own = !!user.employeeId && user.employeeId === detail.employee.id && detail.status === 'published'
    if (!privileged && !own) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json(detail)
  })
}
