import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const input = z.object({
  name: z.string().trim().min(1).max(160),
  dateFrom: isoDate,
  dateTo: isoDate,
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(z.object({
    analyticAccountId: z.string().uuid(),
    accountCode: z.string().trim().min(1).max(20),
    plannedAmount: z.coerce.number().finite().nonnegative().max(9_999_999_999.99),
    notes: z.string().trim().max(1000).nullable().optional(),
  }).strict()).min(1).max(1000),
}).strict()

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const budgets = await prisma.analyticBudget.findMany({
      include: { lines: { include: { analyticAccount: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: [{ dateFrom: 'desc' }, { createdAt: 'desc' }],
    })
    return NextResponse.json({ budgets })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const parsed = input.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid analytic budget', issues: parsed.error.issues }, { status: 422 })
    const body = parsed.data
    if (body.dateTo < body.dateFrom) return NextResponse.json({ error: 'Budget end date must be on or after start date' }, { status: 422 })
    const analyticIds = [...new Set(body.lines.map(line => line.analyticAccountId))]
    const accountCodes = [...new Set(body.lines.map(line => line.accountCode))]
    const [analytics, accounts] = await Promise.all([
      prisma.analyticAccount.findMany({ where: { id: { in: analyticIds }, isActive: true }, select: { id: true } }),
      prisma.accountCode.findMany({ where: { code: { in: accountCodes }, isActive: true }, select: { code: true } }),
    ])
    if (analytics.length !== analyticIds.length) return NextResponse.json({ error: 'Every analytic account must exist and be active' }, { status: 422 })
    if (accounts.length !== accountCodes.length) return NextResponse.json({ error: 'Every general-ledger account must exist and be active' }, { status: 422 })
    const dimensions = new Set<string>()
    for (const line of body.lines) {
      const key = `${line.analyticAccountId}:${line.accountCode}`
      if (dimensions.has(key)) return NextResponse.json({ error: 'Duplicate analytic/account line in budget' }, { status: 422 })
      dimensions.add(key)
    }
    const budget = await prisma.analyticBudget.create({
      data: {
        name: body.name,
        dateFrom: new Date(`${body.dateFrom}T00:00:00Z`),
        dateTo: new Date(`${body.dateTo}T00:00:00Z`),
        notes: body.notes || null,
        lines: { create: body.lines.map(line => ({ ...line, accountCode: line.accountCode, notes: line.notes || null })) },
      },
      include: { lines: { include: { analyticAccount: true } } },
    })
    return NextResponse.json({ budget }, { status: 201 })
  })
}
