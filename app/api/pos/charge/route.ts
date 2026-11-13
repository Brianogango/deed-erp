import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/auth/api'
import { computeInvoiceTotals } from '@/lib/finance-invoice'

export async function POST(request: Request) {
  try {
    const actor = await requirePermission('recordSales')
    const body = await request.json()
    const { lines, customerId, taxTotal, ref } = body

    // Recompute money from line items rather than trusting the client totals.
    const totals = computeInvoiceTotals(Array.isArray(lines) ? lines : [], { headerTax: taxTotal })

    // Use Prisma transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      const posTx = await tx.posTransaction.create({
        data: {
          transactionNumber: ref || `POS-${Date.now()}`,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          clientId: customerId || null,
          cashierId: actor.id,
          sessionId: 'default-session',
        }
      })

      return { success: true, transactionId: posTx.id }
    })

    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' }, { status })
    }
    console.error('POS Charge Error:', error)
    return NextResponse.json({ error: 'Failed to process charge' }, { status: 500 })
  }
}
