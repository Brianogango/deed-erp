import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'

export const dynamic = 'force-dynamic'

// Disciplinary records are sensitive: HR (director, admin officer) only.
const ROLES = ['director', 'admin_officer']
const RECORD_TYPES = ['verbal_warning', 'written_warning', 'final_warning', 'suspension', 'commendation', 'other'] as const

const toClient = (r: { id: string; employeeId: string; recordType: string; incidentDate: Date; description: string; actionTaken: string | null; issuedByName: string | null; createdAt: Date }) => ({
  id: r.id,
  employeeId: r.employeeId,
  recordType: r.recordType,
  incidentDate: r.incidentDate.toISOString().slice(0, 10),
  description: r.description,
  actionTaken: r.actionTaken ?? '',
  issuedByName: r.issuedByName ?? '',
  createdAt: r.createdAt.toISOString(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const rows = await prisma.employeeDisciplinaryRecord.findMany({
      where: { employeeId: id },
      orderBy: { incidentDate: 'desc' },
    })
    return NextResponse.json(rows.map(toClient))
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({}))
    const recordType = String(body.recordType ?? '')
    if (!(RECORD_TYPES as readonly string[]).includes(recordType)) {
      return NextResponse.json({ error: 'Choose a valid record type' }, { status: 400 })
    }
    const description = String(body.description ?? '').trim()
    if (!description) return NextResponse.json({ error: 'A description is required' }, { status: 400 })
    const incidentDate = new Date(`${String(body.incidentDate ?? '')}T00:00:00Z`)
    if (Number.isNaN(incidentDate.getTime())) return NextResponse.json({ error: 'Enter a valid incident date' }, { status: 400 })
    const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true } })
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const created = await prisma.employeeDisciplinaryRecord.create({
      data: {
        employeeId: id,
        recordType,
        incidentDate,
        description: description.slice(0, 4000),
        actionTaken: String(body.actionTaken ?? '').trim().slice(0, 2000) || null,
        issuedByName: actor.name?.slice(0, 160) ?? null,
        createdById: /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null,
      },
    })
    await writeFinancialAudit({
      userId: actor.id, action: 'create_disciplinary_record', entityType: 'employee', entityId: id,
      newValues: { recordType, incidentDate: created.incidentDate.toISOString().slice(0, 10) },
    })
    return NextResponse.json(toClient(created), { status: 201 })
  })
}
