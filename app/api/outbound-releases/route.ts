import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { isUUID } from '@/lib/utils'

const INIT_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'technical_lead', 'release_authoriser']

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const status  = searchParams.get('status')
    const serial  = searchParams.get('serial')
    const invoice = searchParams.get('invoiceId')
    const repair  = searchParams.get('repairId')

    const releases = await prisma.outboundRelease.findMany({
      where: {
        ...(status  ? { status }  : {}),
        ...(invoice ? { invoiceId: invoice } : {}),
        ...(repair  ? { repairId: repair }   : {}),
        ...(serial  ? { items: { some: { expectedSerial: { contains: serial, mode: 'insensitive' } } } } : {}),
      },
      include: {
        initiatedBy: { select: { id: true, username: true } },
        verifiedBy:  { select: { id: true, username: true } },
        items:       true,
        auditLog:    { orderBy: { performedAt: 'asc' } },
      },
      orderBy: { initiatedAt: 'desc' },
    })
    return NextResponse.json(releases)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await requireRole(INIT_ROLES)
    const body    = await request.json()

    if (!body.clientId || !body.serials?.length) {
      return NextResponse.json({ error: 'clientId and serials are required' }, { status: 400 })
    }
    if (!body.invoiceId && !body.repairId && !body.deliveryNoteId) {
      return NextResponse.json({ error: 'At least one source document ID is required' }, { status: 400 })
    }

    const count = await prisma.outboundRelease.count()
    const ref   = `ORC/${String(count + 1).padStart(4, '0')}`

    const release = await prisma.outboundRelease.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        ref,
        ...(isUUID(body.invoiceId)      ? { invoiceId: body.invoiceId }           : {}),
        ...(isUUID(body.repairId)       ? { repairId: body.repairId }             : {}),
        ...(isUUID(body.deliveryNoteId) ? { deliveryNoteId: body.deliveryNoteId } : {}),
        clientId:     body.clientId,
        status:       'pending',
        initiatedById: session.user.id,
        items: {
          create: (body.serials as { serialNumberId: string; expectedSerial: string }[]).map(s => ({
            ...(isUUID(s.serialNumberId) ? { serialNumberId: s.serialNumberId } : {}),
            expectedSerial: s.expectedSerial,
            status: 'picked',
          })),
        },
        auditLog: {
          create: [{
            action: 'initiated', toStatus: 'pending',
            performedById: session.user.id,
          }],
        },
      },
      include: { items: true, auditLog: true },
    })
    return NextResponse.json(release, { status: 201 })
  })
}
