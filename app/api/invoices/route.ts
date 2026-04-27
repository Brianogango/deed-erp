import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// GET /api/invoices
export async function GET(request: Request) {
  try {
    const invoices = await prisma.invoice.findMany({
      include: { lines: true },
      orderBy: { date: 'desc' },
    })
    return NextResponse.json(invoices)
  } catch (error) {
    console.error('[API_INVOICES_GET]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// POST /api/invoices
export async function POST(request: Request) {
  try {
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
            productId: l.productId,
            accountCode: l.accountCode
          })) || []
        }
      },
      include: { lines: true }
    })
    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    console.error('[API_INVOICES_POST]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}