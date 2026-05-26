import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession } from '@/lib/auth/api'

export async function POST(request: Request) {
  try {
    await getRequiredSession()
    const body = await request.json()
    const { lines, payment, customerId, customerName, pointsRedeemed, total, subtotal, taxTotal, ref } = body

    // Use Prisma transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the POS Transaction record
      const posTx = await tx.posTransaction.create({
        data: {
          transactionNumber: ref || `POS-${Date.now()}`,
          subtotal: parseFloat(subtotal),
          taxAmount: parseFloat(taxTotal),
          totalAmount: parseFloat(total),
          clientId: customerId || null,
          cashierId: 'system',
          sessionId: 'default-session',
        }
      })
      
      return { success: true, transactionId: posTx.id }
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('POS Charge Error:', error)
    return NextResponse.json({ error: 'Failed to process charge' }, { status: 500 })
  }
}
