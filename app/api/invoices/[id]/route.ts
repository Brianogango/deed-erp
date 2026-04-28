import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// PUT /api/invoices/[id]
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const body = await request.json()
    const { lines, ...invoiceData } = body

    if (invoiceData.date) invoiceData.date = new Date(invoiceData.date)
    if (invoiceData.dueDate) invoiceData.dueDate = new Date(invoiceData.dueDate)

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        ...invoiceData,
        lines: lines ? {
          deleteMany: {},
          create: lines.map((l: any) => ({
            id: l.id,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            subtotal: l.subtotal,
            productId: l.productId,
            accountCode: l.accountCode
          }))
        } : undefined
      },
      include: { lines: true }
    })
    return NextResponse.json(invoice)
  } catch (error) {
    console.error('[API_INVOICES_PUT]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// DELETE /api/invoices/[id]
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.invoice.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}