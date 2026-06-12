import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { resolveClientId } from '@/lib/legacy-compat'
import { mapInvoiceItems, mapInvoiceUpdateToDb } from '../invoice-mapping'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const invoice = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: { items: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(invoice)
  })
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    const lines: any[] | undefined = body.lines ?? body.items ?? undefined
    const clientId = (body.clientId !== undefined || body.partnerId !== undefined)
      ? await resolveClientId(prisma, body.clientId ?? body.partnerId, body)
      : undefined

    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        ...mapInvoiceUpdateToDb(body, clientId),
        ...(lines !== undefined ? {
          items: {
            deleteMany: {},
            create: mapInvoiceItems(lines),
          }
        } : {}),
      },
      include: { items: true },
    })
    return NextResponse.json(invoice)
  })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    // Delete items first (no cascade in schema), then the invoice.
    const itemDelete = (prisma as any).invoiceItem?.deleteMany?.({ where: { invoiceId: params.id } })
    const invoiceDelete = prisma.invoice.delete({ where: { id: params.id } })
    if (itemDelete && typeof (prisma as any).$transaction === 'function') {
      await (prisma as any).$transaction([itemDelete, invoiceDelete])
    } else {
      if (itemDelete) await itemDelete
      await invoiceDelete
    }
    return NextResponse.json({ ok: true })
  })
}
