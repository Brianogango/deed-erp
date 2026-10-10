import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { isUserAllowed } from '@/lib/auth/authorization'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { HR_ROLES } from '@/lib/hr/appraisals.server'
import { canAcknowledge, canManagerAssess, canSelfAssess, deriveFinalRating, isScore, sanitizeGoals, type Goal } from '@/lib/hr/appraisals'

export const dynamic = 'force-dynamic'

const text = (v: unknown, max = 4000) => String(v ?? '').trim().slice(0, max) || null

/**
 * One endpoint, three steps:
 *   self        the employee writes their self-assessment (status pending_self -> pending_manager)
 *   manager     the manager (or HR) reviews it (pending_manager -> completed)
 *   acknowledge the employee confirms they have seen the completed review
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const { user } = await getRequiredSession()
    const body = await request.json().catch(() => ({}))
    const row = await prisma.appraisal.findUnique({
      where: { id },
      include: { cycle: { select: { status: true } }, employee: { select: { managerId: true } } },
    })
    if (!row) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    if (row.cycle.status !== 'open' && body.action !== 'acknowledge') return NextResponse.json({ error: 'This review cycle is closed' }, { status: 409 })

    const who = { employeeId: user.employeeId ?? null, isHr: isUserAllowed(user, HR_ROLES) }
    const like = { employeeId: row.employeeId, managerEmployeeId: row.employee.managerId, status: row.status as 'pending_self' | 'pending_manager' | 'completed', employeeAckAt: row.employeeAckAt?.toISOString() ?? null }
    const existingGoals = (Array.isArray(row.goals) ? row.goals : []) as unknown as Goal[]

    if (body.action === 'self') {
      if (!canSelfAssess(like, who)) return NextResponse.json({ error: 'You cannot submit this self-assessment' }, { status: 403 })
      const goals = sanitizeGoals(body.goals).map(g => ({ id: g.id, title: g.title, weight: g.weight, ...(g.selfScore ? { selfScore: g.selfScore } : {}) }))
      const selfRating = Number(body.selfRating)
      if (!isScore(selfRating)) return NextResponse.json({ error: 'Give yourself an overall rating from 1 to 5' }, { status: 400 })
      await prisma.appraisal.update({ where: { id }, data: { goals: goals as never, selfComments: text(body.selfComments), selfRating, status: 'pending_manager' } })
    } else if (body.action === 'manager') {
      if (!canManagerAssess(like, who)) return NextResponse.json({ error: 'You cannot review this employee' }, { status: 403 })
      // The employee's goals and self-scores stay as written; the reviewer adds their own scores.
      const incoming = new Map(sanitizeGoals(body.goals).map(g => [g.id, g]))
      const goals = existingGoals.map(g => ({ ...g, ...(incoming.get(g.id)?.managerScore ? { managerScore: incoming.get(g.id)!.managerScore } : {}) }))
      const managerRating = Number(body.managerRating)
      if (!isScore(managerRating)) return NextResponse.json({ error: 'Give an overall rating from 1 to 5' }, { status: 400 })
      const finalRating = deriveFinalRating({ managerRating, selfRating: row.selfRating, goals })
      await prisma.appraisal.update({
        where: { id },
        data: {
          goals: goals as never, managerComments: text(body.managerComments), strengths: text(body.strengths), improvements: text(body.improvements),
          managerRating, finalRating, status: 'completed',
          reviewerName: String(body.reviewerName ?? '').trim().slice(0, 160) || row.reviewerName,
        },
      })
    } else if (body.action === 'acknowledge') {
      if (!canAcknowledge(like, who)) return NextResponse.json({ error: 'There is nothing to acknowledge' }, { status: 403 })
      await prisma.appraisal.update({ where: { id }, data: { employeeAckAt: new Date() } })
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    await writeFinancialAudit({ userId: user.id, action: `appraisal_${body.action}`, entityType: 'employee', entityId: row.employeeId, newValues: { appraisalId: id } })
    return NextResponse.json({ ok: true })
  })
}
