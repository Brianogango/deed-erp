import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { runIntegritySuite } from '@/lib/accounting/integrity-suite'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const period = await prisma.fiscalPeriod.findUnique({ where: { id: params.id } })
    if (!period) return NextResponse.json({ error: 'Fiscal period not found' }, { status: 404 })
    if (period.state === 'closed') {
      return NextResponse.json({ error: 'Period is already closed' }, { status: 409 })
    }

    const asOf = period.dateTo.toISOString().slice(0, 10)
    const integrity = await runIntegritySuite(asOf)
    if (!integrity.allPassed) {
      return NextResponse.json(
        { error: 'Cannot close period while integrity gates fail', integrity },
        { status: 409 },
      )
    }

    const closed = await prisma.$transaction(async tx => {
      const next = await tx.fiscalPeriod.update({
        where: { id: period.id },
        data: { state: 'closed', closedById: actor.id, closedAt: new Date() },
      })
      const existingLock = await tx.fiscalLock.findFirst({ orderBy: { lockDate: 'desc' } })
      if (existingLock) {
        if (existingLock.lockDate < period.dateTo) {
          await tx.fiscalLock.update({
            where: { id: existingLock.id },
            data: { lockDate: period.dateTo, updatedBy: actor.id, note: `Closed ${period.name}` },
          })
        }
      } else {
        await tx.fiscalLock.create({
          data: { lockDate: period.dateTo, updatedBy: actor.id, note: `Closed ${period.name}` },
        })
      }
      return next
    })

    await writeFinancialAudit({
      userId: actor.id,
      action: 'close_fiscal_period',
      entityType: 'fiscal_period',
      entityId: period.id,
      newValues: { name: period.name, asOf },
    })

    return NextResponse.json({ period: closed, integrity })
  })
}
