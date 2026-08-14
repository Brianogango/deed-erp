import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

const READ_ROLES = ['director', 'finance_officer', 'admin_officer', 'sales_rep', 'technical_lead']
const WRITE_ROLES = ['director', 'finance_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(READ_ROLES)
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
    await requireRole(WRITE_ROLES)
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
