import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const id = params.id
    const body = await request.json()
    const autoInvoice = body.autoInvoice ?? false

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: { lines: true }
    })

    if (!delivery) throw Object.assign(new Error('Delivery not found'), { status: 404 })
    if (delivery.status === 'done') throw Object.assign(new Error('Delivery already validated'), { status: 400 })

    const so = await prisma.saleOrder.findUnique({
      where: { id: delivery.saleOrderId },
      include: { lines: true }
    })

    if (!so) throw Object.assign(new Error('Sale Order not found'), { status: 404 })

    const products = await prisma.product.findMany({
      where: { id: { in: delivery.lines.map(l => l.productId) } }
    })

    // Execute Atomic Transaction
    const result = await prisma.$transaction(async (tx) => {
      let warrantiesCreated = false
      const now = new Date()

      // A. Mark Delivery as Done
      const updatedDel = await tx.delivery.update({
        where: { id },
        data: { status: 'done' }
      })

      // B. Mark Sale Order as Delivered
      await tx.saleOrder.update({
        where: { id: delivery.saleOrderId },
        data: { status: 'delivered' }
      })

      // C. Process Lines (Stock Moves, Serials, Warranties)
      for (const line of delivery.lines) {
        const product = products.find(p => p.id === line.productId)
        if (!product) continue

        // Record Stock Move
        await tx.stockMove.create({
          data: {
            type: 'out',
            productId: line.productId,
            productName: line.productName,
            qty: line.qty,
            reason: `Delivery ${delivery.ref}`,
            fromLocation: line.sourceLocation || 'warehouse',
            toLocation: 'customer',
            serialNumbers: line.serialIds || [],
            date: now,
            userId: session.user.id,
            documentRef: delivery.ref
          }
        })

        // Update Serials and Create Warranties
        if (line.serialIds && line.serialIds.length > 0) {
          await tx.serialNumber.updateMany({
            where: { id: { in: line.serialIds } },
            data: { status: 'sold', location: 'customer', soldDate: now, saleOrderId: delivery.saleOrderId }
          })

          if (product.warrantyMonths > 0) {
            warrantiesCreated = true
            const serials = await tx.serialNumber.findMany({ where: { id: { in: line.serialIds } } })

            for (const serial of serials) {
              const endDate = new Date(now)
              endDate.setMonth(endDate.getMonth() + product.warrantyMonths)

              await tx.warranty.create({
                data: {
                  ref: `WAR/${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
                  customerId: delivery.customerId, customerName: delivery.customerName,
                  productId: line.productId, productName: line.productName,
                  serialId: serial.id, serialNumber: serial.serial,
                  deliveryId: delivery.id, saleOrderRef: so.ref,
                  startDate: now, endDate, status: 'active', months: product.warrantyMonths
                }
              })
            }
          }
        }
      }

      // D. Auto-Invoice
      let invoiceCreated = null
      if (autoInvoice) {
        const invoiceLines = delivery.lines.map(dl => {
          const soLine = so.lines.find(sl => sl.productId === dl.productId)
          return { description: dl.productName, qty: dl.qty, unitPrice: soLine?.unitPrice || 0, taxRate: 16, subtotal: soLine?.subtotal || 0, productId: dl.productId }
        })
        const dueDate = new Date(now); dueDate.setDate(dueDate.getDate() + 30)
        invoiceCreated = await tx.invoice.create({
          data: { ref: `INV/${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`, type: 'customer_invoice', status: 'posted', partnerId: delivery.customerId, partnerName: delivery.customerName, date: now, dueDate, subtotal: so.subtotal, taxTotal: so.taxTotal, total: so.total, amountPaid: 0, saleOrderId: so.id, notes: `Invoice for ${so.ref} via ${delivery.ref}`, lines: { create: invoiceLines } }
        })
        await tx.saleOrder.update({ where: { id: so.id }, data: { invoiceId: invoiceCreated.id, status: 'invoiced' } })
      }

      if (warrantiesCreated) {
        await tx.delivery.update({ where: { id }, data: { warrantyCreated: true } })
      }

      return { delivery: updatedDel, invoice: invoiceCreated }
    })

    return NextResponse.json(result)
  })
}