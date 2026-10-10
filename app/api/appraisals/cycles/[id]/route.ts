import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { HR_ROLES } from '@/lib/hr/appraisals.server'

export const dynamic = 'force-dynamic'

/** Close (or reopen) a review cycle. Closing is only allowed once every review in it is completed, unless `force` is set. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(HR_ROLES)
    const body = await request.json().catch(() => ({}))
    const status = body.status === 'open' ? 'open' : 'closed'
    const cycle = await prisma.appraisalCycle.findUnique({ where: { id } })
    if (!cycle) return NextResponse.json({ error: 'Review cycle not found' }, { status: 404 })
    if (status === 'closed' && !body.force) {
      const open = await prisma.appraisal.count({ where: { cycleId: id, status: { not: 'completed' } } })
      if (open > 0) return NextResponse.json({ error: `${open} review${open === 1 ? ' is' : 's are'} not completed yet. Close anyway to lock them as they are.`, openCount: open }, { status: 409 })
    }
    await prisma.appraisalCycle.update({ where: { id }, data: { status } })
    await writeFinancialAudit({ userId: actor.id, action: `${status}_appraisal_cycle`, entityType: 'appraisal_cycle', entityId: id, newValues: { status } })
    return NextResponse.json({ ok: true, status })
  })
}
