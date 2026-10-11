import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling } from '@/lib/auth/api'
import { requireCreditUser } from '@/lib/credit/credit-facility-auth.server'
import { OPEN_STATUSES } from '@/lib/credit/credit-facility-rules'

/**
 * GET — customers whose credit is due (or overdue) for review in the next 30
 * days: approved credit and legacy credit given before applications existed.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireCreditUser()
    const soon = new Date(Date.now() + 30 * 86_400_000)
    const clients = await prisma.client.findMany({
      where: { creditStatus: { in: ['approved', 'legacy'] }, creditReviewDue: { lte: soon }, isActive: true },
      select: { id: true, name: true, creditStatus: true, creditReviewDue: true, creditLimit: true, paymentTermsDays: true, clientType: true },
      orderBy: { creditReviewDue: 'asc' },
      take: 500,
    })
    const open = await prisma.creditFacilityApplication.findMany({
      where: { clientId: { in: clients.map(c => c.id) }, status: { in: OPEN_STATUSES } },
      select: { clientId: true, id: true, ref: true },
    })
    const openBy = new Map(open.map(a => [a.clientId, a]))
    return NextResponse.json({
      reviews: clients.map(c => ({
        clientId: c.id,
        name: c.name,
        creditStatus: c.creditStatus,
        reviewDue: c.creditReviewDue?.toISOString().slice(0, 10) ?? null,
        creditLimit: Number(c.creditLimit),
        paymentTermsDays: c.paymentTermsDays ?? 0,
        isCompany: c.clientType !== 'individual',
        openApplication: openBy.get(c.id) ?? null,
      })),
    })
  })
}
