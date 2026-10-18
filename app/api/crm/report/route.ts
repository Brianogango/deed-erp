import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { leadRole } from '@/lib/crm/lead-access'
import { buildCrmReport } from '@/lib/crm/crm-report'

export const dynamic = 'force-dynamic'

const day = (v: string | null, fallback: Date) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fallback
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? fallback : d
}

/**
 * GET /api/crm/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Directors, admin and finance officers see the whole team; a rep sees their own.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const role = leadRole(session.user.role)
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const url = new URL(request.url)
    const now = new Date()
    const from = day(url.searchParams.get('from'), new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))
    const toDay = day(url.searchParams.get('to'), now)
    const to = new Date(toDay.getTime() + 86_399_999)
    if (from > to) return NextResponse.json({ error: 'The start date is after the end date' }, { status: 400 })

    const rep = role === 'sales_rep' ? session.user.id : null
    const [leads, deals] = await Promise.all([
      prisma.lead.findMany({
        where: { createdAt: { gte: from, lte: to }, ...(rep ? { ownerId: rep } : {}) },
        select: { id: true, source: true, stage: true, ownerId: true, createdAt: true, activity: true },
      }),
      prisma.opportunity.findMany({
        where: rep ? { OR: [{ assignedToId: rep }, { createdById: rep }] } : {},
        select: { id: true, stage: true, value: true, assignedToId: true, createdById: true, createdAt: true, screenExtras: true },
      }),
    ])
    return NextResponse.json(buildCrmReport({ leads, deals, from, to, reps: [] }))
  })
}
