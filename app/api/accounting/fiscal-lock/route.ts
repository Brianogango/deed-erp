import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(['director', 'finance_officer'])
    const lock = await prisma.fiscalLock.findFirst({ orderBy: { lockDate: 'desc' } })
    if (!lock) {
      return NextResponse.json({ lockDate: null, note: null, updatedBy: null, updatedAt: null })
    }
    return NextResponse.json({
      lockDate: lock.lockDate.toISOString().slice(0, 10),
      note: lock.note,
      updatedBy: lock.updatedBy,
      updatedAt: lock.updatedAt.toISOString(),
    })
  })
}

export async function PUT(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director', 'finance_officer'])
    const body = await request.json().catch(() => ({}))
    const lockDate = body.lockDate
    if (!lockDate || typeof lockDate !== 'string') {
      return NextResponse.json({ error: 'lockDate is required (YYYY-MM-DD)' }, { status: 400 })
    }

    const parsed = new Date(`${lockDate}T00:00:00Z`)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid lockDate' }, { status: 400 })
    }

    const existing = await prisma.fiscalLock.findFirst({ orderBy: { lockDate: 'desc' } })
    const lock = existing
      ? await prisma.fiscalLock.update({
          where: { id: existing.id },
          data: {
            lockDate: parsed,
            note: typeof body.note === 'string' ? body.note : null,
            updatedBy: actor.id,
          },
        })
      : await prisma.fiscalLock.create({
          data: {
            lockDate: parsed,
            note: typeof body.note === 'string' ? body.note : null,
            updatedBy: actor.id,
          },
        })

    return NextResponse.json({
      lockDate: lock.lockDate.toISOString().slice(0, 10),
      note: lock.note,
      updatedBy: lock.updatedBy,
      updatedAt: lock.updatedAt.toISOString(),
    })
  })
}
