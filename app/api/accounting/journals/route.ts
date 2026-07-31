import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

/** Read-only Prisma journals (KES). Never mutates app_state. */
export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const source = searchParams.get('source')
    const q = (searchParams.get('q') || '').trim().toLowerCase()
    const take = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200)))

    const where: any = { isPosted: true, isReversed: false }
    if (dateFrom || dateTo) {
      where.entryDate = {}
      if (dateFrom) where.entryDate.gte = new Date(`${dateFrom}T00:00:00Z`)
      if (dateTo) where.entryDate.lte = new Date(`${dateTo}T23:59:59Z`)
    }
    if (source && source !== 'all') where.sourceType = source

    const rows = await prisma.journalEntry.findMany({
      where,
      include: { lines: { orderBy: { sortOrder: 'asc' } }, journal: true },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take,
    })

    const mapped = rows
      .filter(e => !q || e.ref.toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q))
      .map(e => ({
        id: e.id,
        ref: e.ref,
        date: e.entryDate.toISOString().slice(0, 10),
        source: e.sourceType || e.journal?.journalType || 'general',
        description: e.description || '',
        status: e.isPosted ? 'posted' : 'draft',
        totalDebit: Number(e.totalDebit),
        totalCredit: Number(e.totalCredit),
        invoiceId: e.invoiceId || undefined,
        paymentId: e.paymentId || undefined,
        lines: e.lines.map(l => ({
          id: l.id,
          account: l.accountLabel,
          description: l.label || '',
          debit: Number(l.debit),
          credit: Number(l.credit),
        })),
      }))

    return NextResponse.json({
      currency: 'KES',
      count: mapped.length,
      journals: mapped,
    })
  })
}
