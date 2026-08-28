import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director'])
    const body = await request.json().catch(() => ({}))
    const reason = String(body.reason || '').trim()
    if (!reason) return NextResponse.json({ error: 'reopen reason is required' }, { status: 400 })

    const period = await prisma.fiscalPeriod.findUnique({ where: { id: params.id } })
    if (!period) return NextResponse.json({ error: 'Fiscal period not found' }, { status: 404 })
    if (period.state === 'open') {
      return NextResponse.json({ error: 'Period is already open' }, { status: 409 })
    }

    const reopened = await prisma.fiscalPeriod.update({
      where: { id: period.id },
      data: {
        state: 'open',
        reopenRequestedById: actor.id,
        reopenApprovedById: actor.id,
        reopenReason: reason.slice(0, 500),
        reopenedAt: new Date(),
      },
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'reopen_fiscal_period',
      entityType: 'fiscal_period',
      entityId: period.id,
      approvalReason: reason,
      newValues: { name: period.name },
    })

    return NextResponse.json({ period: reopened })
  })
}
