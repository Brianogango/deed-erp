import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer', 'admin_officer'])
    const periods = await prisma.fiscalPeriod.findMany({ orderBy: { dateFrom: 'desc' } })
    return NextResponse.json({ periods })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '').trim()
    const dateFrom = String(body.dateFrom || '').trim()
    const dateTo = String(body.dateTo || '').trim()
    if (!name || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'name, dateFrom, and dateTo are required' }, { status: 400 })
    }
    const period = await prisma.fiscalPeriod.create({
      data: {
        name,
        dateFrom: new Date(`${dateFrom}T00:00:00Z`),
        dateTo: new Date(`${dateTo}T00:00:00Z`),
        state: 'open',
      },
    })
    void actor
    return NextResponse.json({ period }, { status: 201 })
  })
}
