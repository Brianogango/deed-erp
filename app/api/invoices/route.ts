import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { mapInvoiceBodyToDb, mapInvoiceItems, resolveInvoiceNumber } from './invoice-mapping'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const invoices = await prisma.invoice.findMany({
      include: { items: true },
      orderBy: { invoiceDate: 'desc' },
    })
    return NextResponse.json(invoices)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const body = await request.json()
    const lines: any[] = body.lines ?? body.items ?? []
    const clientId = await resolveClientId(prisma, body.clientId ?? body.partnerId, body)

    let invoiceNumber = resolveInvoiceNumber(body, '')
    if (!invoiceNumber) {
      const count = await prisma.invoice.count()
      invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`
    }

    const invoice = await prisma.invoice.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        ...mapInvoiceBodyToDb(body, clientId),
        invoiceNumber,
        createdById: actor.id,
        items: { create: mapInvoiceItems(lines) },
      } as any,
      include: { items: true },
    })
    return NextResponse.json(invoice, { status: 201 })
  })
}
