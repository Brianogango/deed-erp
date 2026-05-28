import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'

const WRITE_ROLES = ['director', 'finance_officer']

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const invoiceId = params.id
    const body = await request.json()

    const { amount, paymentMethod = 'cash', reference, paidAt, bankAccountId } = body

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 })
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid)
    if (balance <= 0) {
      return NextResponse.json({ error: 'Invoice already fully paid' }, { status: 400 })
    }

    const capped = Math.min(Number(amount), balance)
    const newAmountPaid = Number(invoice.amountPaid) + capped
    const fullyPaid = newAmountPaid >= Number(invoice.totalAmount)
    const newStatus = fullyPaid ? 'paid' : 'partially_paid'

    const notes = bankAccountId ? `Account: ${bankAccountId}` : null

    const [payment, updatedInvoice] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId,
          amount: capped,
          paymentMethod: paymentMethod as any,
          reference: reference || null,
          paidAt: paidAt ? new Date(paidAt) : new Date(),
          notes,
          createdById: actor.id,
        },
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          amountPaid: newAmountPaid,
          status: newStatus as any,
        },
      }),
    ])

    return NextResponse.json({ payment, invoice: updatedInvoice })
  })
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  return withApiErrorHandling(async () => {
    await requireRole([...WRITE_ROLES, 'admin_officer'])
    const payments = await prisma.payment.findMany({
      where: { invoiceId: params.id, isVoided: false },
      orderBy: { paidAt: 'asc' },
    })
    return NextResponse.json(payments)
  })
}
