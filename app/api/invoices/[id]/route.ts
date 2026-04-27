import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// PUT /api/payments/[id]
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const body = await request.json()
    const { invoices, ...paymentData } = body

    if (paymentData.receivedDate) paymentData.receivedDate = new Date(paymentData.receivedDate)
    if (paymentData.clearedDate) paymentData.clearedDate = new Date(paymentData.clearedDate)
    if (paymentData.accountingDate) paymentData.accountingDate = new Date(paymentData.accountingDate)

    const payment = await prisma.payment.update({
      where: { id },
      data: {
        ...paymentData,
        invoices: invoices ? {
          deleteMany: {},
          create: invoices.map((i: any) => ({
            invoiceId: i.invoiceId,
            invoiceRef: i.invoiceRef,
            amountAllocated: i.amountAllocated
          }))
        } : undefined
      },
      include: { invoices: true }
    })
    return NextResponse.json(payment)
  } catch (error) {
    console.error('[API_PAYMENTS_PUT]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}