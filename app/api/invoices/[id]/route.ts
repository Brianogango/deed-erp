import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const body = await request.json()
    const { lines, ...invoiceData } = body

    // Support both old `date` field and new `invoiceDate`
    if (invoiceData.date && !invoiceData.invoiceDate) {
      invoiceData.invoiceDate = new Date(invoiceData.date)
    } else if (invoiceData.invoiceDate) {
      invoiceData.invoiceDate = new Date(invoiceData.invoiceDate)
    }
    delete invoiceData.date
    if (invoiceData.dueDate) invoiceData.dueDate = new Date(invoiceData.dueDate)

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        ...invoiceData,
        items: lines
          ? {
              deleteMany: {},
              create: lines.map((l: any) => ({
                description: l.description ?? '',
                qty: l.qty ?? 1,
                unitPrice: l.unitPrice ?? 0,
                taxRate: l.taxRate ?? 0,
                lineSubtotal: l.subtotal ?? l.lineSubtotal ?? 0,
                lineTax: l.lineTax ?? 0,
                lineTotal: l.lineTotal ?? l.subtotal ?? 0,
                ...(l.productId ? { productId: l.productId } : {}),
              })),
            }
          : undefined,
      },
      include: { items: true },
    })
    return NextResponse.json(invoice)
  } catch (error) {
    console.error('[API_INVOICES_PUT]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.invoice.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
