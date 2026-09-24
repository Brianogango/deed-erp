import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { isUUID } from '@/lib/utils'
import { getNextOrcRef } from '@/lib/orc-ref-counter'

// 'release_authoriser' was previously listed here but isn't a real UserRole (see lib/auth/types.ts) —
// it could never match an actual user, so it's been dropped.
const INIT_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'technical_lead']

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
        // Both are uuid columns — an unguarded filter value turns a mistyped
        // query string into a 500 instead of an empty list.
        ...(isUUID(invoice) ? { invoiceId: invoice } : {}),
        ...(isUUID(repair)  ? { repairId: repair }   : {}),
        ...(serial  ? { items: { some: { expectedSerial: { contains: serial, mode: 'insensitive' } } } } : {}),
      } as any,
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
    const actor = await requireRole(INIT_ROLES)
    const body    = await request.json()

    if (!body.clientId || !body.serials?.length) {
      return NextResponse.json({ error: 'clientId and serials are required' }, { status: 400 })
    }
    if (!body.invoiceId && !body.repairId && !body.deliveryNoteId) {
      return NextResponse.json({ error: 'At least one source document ID is required' }, { status: 400 })
    }

    // clientId is a required uuid column and was the one id here not guarded.
    // Repair intake stores customerId as free text and leaves it empty for
    // walk-ins, so a repair release arrived with '' and Postgres answered
    // `invalid input syntax for type uuid` — a 500 the storekeeper saw as the
    // release simply refusing to open. Fall back to the source document's own
    // client before giving up, since that is the same customer.
    let clientId: string | null = isUUID(body.clientId) ? String(body.clientId) : null
    if (!clientId && isUUID(body.repairId)) {
      const repair = await prisma.repair.findUnique({
        where: { id: String(body.repairId) },
        select: { clientId: true },
      })
      clientId = repair?.clientId ?? null
    }
    if (!clientId && isUUID(body.invoiceId)) {
      const invoice = await prisma.invoice.findUnique({
        where: { id: String(body.invoiceId) },
        select: { clientId: true },
      })
      clientId = invoice?.clientId ?? null
    }
    if (!clientId) {
      return NextResponse.json({
        error: 'This release has no customer on file. Attach a customer record to the repair or invoice before releasing the device.',
      }, { status: 422 })
    }

    // serialNumberId is required, not optional. Spreading it conditionally
    // dropped it for devices with no serial row — customer-owned repairs,
    // mostly — and Prisma rejected the whole nested create. The `as any` on
    // the call below is why the compiler never said so.
    const serials = body.serials as { id?: string; serialNumberId?: string; expectedSerial?: string }[]
    const unserialised = serials.filter(s => !isUUID(s?.serialNumberId))
    if (unserialised.length > 0) {
      const names = unserialised.map(s => String(s?.expectedSerial ?? 'unknown')).join(', ')
      return NextResponse.json({
        error: `These units are not in the serial register and cannot be released: ${names}. Add them to inventory first.`,
      }, { status: 422 })
    }

    const ref = await getNextOrcRef()

    const release = await prisma.outboundRelease.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        ref,
        ...(isUUID(body.invoiceId)      ? { invoiceId: body.invoiceId }           : {}),
        ...(isUUID(body.repairId)       ? { repairId: body.repairId }             : {}),
        ...(isUUID(body.deliveryNoteId) ? { deliveryNoteId: body.deliveryNoteId } : {}),
        clientId,
        status:       'pending',
        initiatedById: actor.id,
        items: {
          create: serials.map(s => ({
            ...(isUUID(s.id) ? { id: s.id } : {}),
            serialNumberId: String(s.serialNumberId),
            expectedSerial: String(s.expectedSerial ?? ''),
            status: 'picked',
          })),
        },
        auditLog: {
          create: [{
            action: 'initiated', toStatus: 'pending',
            performedById: actor.id,
          }],
        },
      } as any,
      include: { items: true, auditLog: true },
    })
    return NextResponse.json(release, { status: 201 })
  })
}
