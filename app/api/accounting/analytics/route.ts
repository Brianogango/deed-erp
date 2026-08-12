import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { budgetVariance, distributeAnalyticAmount } from '@/lib/accounting/analytics'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const { searchParams } = new URL(request.url)
    const resource = searchParams.get('resource') || 'accounts'

    if (resource === 'tags') {
      const tags = await prisma.analyticTag.findMany({ orderBy: { code: 'asc' } })
      return NextResponse.json({ ok: true, tags })
    }
    if (resource === 'budgets') {
      const budgets = await prisma.budget.findMany({
        include: { lines: true },
        orderBy: { fiscalYear: 'desc' },
        take: 24,
      })
      return NextResponse.json({
        ok: true,
        budgets: budgets.map(b => ({
          ...b,
          lines: b.lines.map(l => ({
            ...l,
            amount: Number(l.amount),
            variance: budgetVariance(Number(l.amount), 0),
          })),
        })),
      })
    }

    const accounts = await prisma.analyticAccount.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    })
    return NextResponse.json({ ok: true, accounts })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const kind = String(body.kind || 'account')

    if (kind === 'tag') {
      const tag = await prisma.analyticTag.create({
        data: {
          code: String(body.code || '').trim(),
          name: String(body.name || '').trim(),
          color: body.color ? String(body.color) : null,
        },
      })
      return NextResponse.json({ ok: true, tag }, { status: 201 })
    }

    if (kind === 'budget') {
      const budget = await prisma.budget.create({
        data: {
          name: String(body.name || '').trim(),
          fiscalYear: Number(body.fiscalYear),
          dateFrom: new Date(`${body.dateFrom}T00:00:00Z`),
          dateTo: new Date(`${body.dateTo}T00:00:00Z`),
          status: 'draft',
          notes: body.notes ? String(body.notes) : null,
          lines: {
            create: Array.isArray(body.lines)
              ? body.lines.map((l: { accountCode?: string; analyticAccountId?: string; amount?: number; notes?: string }) => ({
                  accountCode: l.accountCode || null,
                  analyticAccountId: l.analyticAccountId || null,
                  amount: Number(l.amount || 0),
                  notes: l.notes || null,
                }))
              : [],
          },
        },
        include: { lines: true },
      })
      return NextResponse.json({ ok: true, budget }, { status: 201 })
    }

    if (kind === 'distribute') {
      const splits = distributeAnalyticAmount(Number(body.amount || 0), body.splits || [])
      return NextResponse.json({ ok: true, splits })
    }

    const account = await prisma.analyticAccount.create({
      data: {
        code: String(body.code || '').trim(),
        name: String(body.name || '').trim(),
        parentId: body.parentId || null,
        notes: body.notes ? String(body.notes) : null,
      },
    })
    return NextResponse.json({ ok: true, account }, { status: 201 })
  })
}
