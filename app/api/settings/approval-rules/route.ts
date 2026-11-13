import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { withApiErrorHandling, requirePermission } from '@/lib/auth/api'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requirePermission('settings.approval_rules.view')
    try {
      const rules = await prisma.approvalRule.findMany({ orderBy: { approvalType: 'asc' } })
      return NextResponse.json(rules)
    } catch {
      return NextResponse.json([])
    }
  })
}

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    await requirePermission('settings.commercial')
    const body = await request.json()
    const approvalType = String(body.approvalType || '').trim()
    if (!approvalType) return NextResponse.json({ error: 'approvalType required' }, { status: 400 })
    if (approvalType === 'purchase_high_value') {
      return NextResponse.json(
        { error: 'High-value PO approval was removed — confirming a purchase order is not amount-gated' },
        { status: 400 },
      )
    }
    const thresholds = Array.isArray(body.thresholds) ? body.thresholds : []
    const isActive = body.isActive !== false

    const rule = await prisma.approvalRule.upsert({
      where: { approvalType },
      create: { approvalType, thresholds, isActive },
      update: { thresholds, isActive },
    })
    return NextResponse.json(rule)
  })
}
