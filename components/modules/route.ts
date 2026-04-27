import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// PUT /api/receipts/[id]
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const body = await request.json()
    const { lines, ...receiptData } = body

    if (receiptData.date) receiptData.date = new Date(receiptData.date)

    const receipt = await prisma.receipt.update({
      where: { id },
      data: {
        ...receiptData,
        lines: lines ? {
          deleteMany: {},
          create: lines.map((l: any) => ({
            productId: l.productId,
            productName: l.productName,
            qtyExpected: l.qtyExpected,
            qtyReceived: l.qtyReceived,
            serials: l.serials || [],
            requiresSerial: l.requiresSerial,
            importedSerials: l.importedSerials || [],
            specs: l.specs
          }))
        } : undefined
      },
      include: { lines: true }
    })
    return NextResponse.json(receipt)
  } catch (error) {
    console.error('[API_RECEIPTS_PUT]', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}