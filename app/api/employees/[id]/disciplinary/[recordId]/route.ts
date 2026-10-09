import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

// Removing a record is a director-only correction.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  const { id, recordId } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(['director'])
    const record = await prisma.employeeDisciplinaryRecord.findFirst({ where: { id: recordId, employeeId: id } })
    if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    await prisma.employeeDisciplinaryRecord.delete({ where: { id: recordId } })
    await writeFinancialAudit({
      userId: actor.id, action: 'delete_disciplinary_record', entityType: 'employee', entityId: id,
      oldValues: { recordType: record.recordType, incidentDate: record.incidentDate.toISOString().slice(0, 10) },
    })
    return NextResponse.json({ ok: true })
  })
}
