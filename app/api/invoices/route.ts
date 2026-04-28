import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, requireRole, withApiErrorHandling } from '@/lib/auth/api'

const WRITE_ROLES = ['admin', 'finance']

export async function GET() {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const invoices = await prisma.invoice.findMany({
      include: { lines: true },
      orderBy: { date: 'desc' },
    })
    return NextResponse.json(invoices)
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireRole(WRITE_ROLES)
    const body = await request.json()
    const { lines, ...invoiceData } = body
    if (invoiceData.date) invoiceData.date = new Date(invoiceData.date)
    if (invoiceData.dueDate) invoiceData.dueDate = new Date(invoiceData.dueDate)
    const invoice = await prisma.invoice.create({
      data: {
        ...invoiceData,
        lines: {
          create: lines?.map((l: any) => ({
            id: l.id,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            subtotal: l.subtotal,
          })) || [],
        },
      },
      include: { lines: true },
    })
    return NextResponse.json(invoice, { status: 201 })
  })
}
