import { NextResponse } from 'next/server'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import prisma from '@/lib/prisma'
import { writeFinancialAuditInTx } from '@/lib/finance-audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
const DEPOSIT_WRITE_ROLES = ['director', 'admin_officer', 'finance_officer']

const depositMetadataSchema = z.object({
  notes: z.string().trim().max(10_000).optional().nullable(),
  dueDate: z.string().trim().max(40).optional().nullable(),
  customerPhone: z.string().trim().max(50).optional().nullable(),
}).strict()

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const row = await prisma.deposit.findUnique({
      where: { id: params.id },
      include: { items: { orderBy: { sortOrder: 'asc' } }, payments: { orderBy: { paidAt: 'asc' } } },
    })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(row)
  })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(DEPOSIT_WRITE_ROLES)
    const parsed = depositMetadataSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid deposit update' }, { status: 422 })
    const body = parsed.data
    const before = await prisma.deposit.findUnique({ where: { id: params.id } })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (['completed','cancelled'].includes(before.status)) {
      return NextResponse.json({ error: 'Completed/cancelled deposits are immutable' }, { status: 409 })
    }
    const patch: Record<string, any> = {}
    if (body.notes !== undefined) patch.notes = body.notes || null
    if (body.dueDate !== undefined) {
      if (!body.dueDate) patch.dueDate = null
      else {
        const dueDate = new Date(body.dueDate)
        if (Number.isNaN(dueDate.getTime())) return NextResponse.json({ error: 'Invalid deposit due date' }, { status: 422 })
        patch.dueDate = dueDate
      }
    }
    if (body.customerPhone !== undefined) patch.customerPhone = body.customerPhone || null
    const updated = await prisma.$transaction(async tx => {
      const row = await tx.deposit.update({ where: { id: params.id }, data: patch })
      await writeFinancialAuditInTx(tx, {
        userId: actor.id,
        action: 'update_deposit_metadata',
        entityType: 'deposit',
        entityId: params.id,
        oldValues: { notes: before.notes, dueDate: before.dueDate, customerPhone: before.customerPhone },
        newValues: patch,
      })
      return row
    })
    return NextResponse.json(updated)
  })
}
