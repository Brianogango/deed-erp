/**
 * POST /api/sale-orders/:id/deliver-lines
 *
 * Updates the qtyDelivered for each order line item.
 * If every line's qtyDelivered >= qty, the order status is automatically
 * advanced to "delivered".
 *
 * Body: { lines: Array<{ id: string; qtyDelivered: number }> }
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'

const DELIVER_ROLES = ['director', 'admin_officer', 'inventory_officer', 'sales_rep']

async function broadcastSaleOrders() {
  try {
    const all = await prisma.saleOrder.findMany({
      include: { client: true, items: true },
      orderBy: { createdAt: 'desc' },
    })
    const mapped = all.map((order: any) => ({
      ...order,
      ref: order.orderNumber,
      customerId: order.clientId,
      customerName: order.client?.name ?? '',
      date: order.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : '',
      total: Number(order.totalAmount ?? 0),
      taxTotal: Number(order.taxAmount ?? 0),
      subtotal: Number(order.subtotal ?? 0),
      lines: (order.items ?? []).map((item: any) => ({
        id: item.id,
        productId: item.productId ?? '',
        productName: item.description ?? '',
        description: item.description ?? '',
        qty: Number(item.qty ?? 0),
        qtyDelivered: Number(item.qtyDelivered ?? 0),
        unitPrice: Number(item.unitPrice ?? 0),
        taxRate: Number(item.taxRate ?? 0),
        subtotal: Number(item.lineTotal ?? 0),
        lineTotal: Number(item.lineTotal ?? 0),
        serialIds: item.serialNumberId ? [item.serialNumberId] : [],
        notes: item.notes ?? undefined,
      })),
    }))
    void saveStoreKeys({ deed_saleOrders: JSON.stringify(mapped) })
  } catch {}
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!DELIVER_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const lineUpdates: Array<{ id: string; qtyDelivered: number }> = body.lines ?? []

    if (!Array.isArray(lineUpdates) || lineUpdates.length === 0) {
      return NextResponse.json({ error: 'lines array is required' }, { status: 400 })
    }

    // Fetch the order to verify it exists and is in 'confirmed' status
    const order = await prisma.saleOrder.findUnique({
      where: { id: params.id },
      include: { items: true },
    })
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (order.status !== 'confirmed') {
      return NextResponse.json({ error: 'Order must be in confirmed status to record delivery' }, { status: 422 })
    }

    // Update each line's qtyDelivered individually
    await Promise.all(
      lineUpdates.map(({ id, qtyDelivered }) =>
        prisma.saleOrderItem.update({
          where: { id },
          data: { qtyDelivered: Math.max(0, Number(qtyDelivered ?? 0)) },
        })
      )
    )

    // Re-fetch items to check if all lines are fully delivered
    const updatedItems = await prisma.saleOrderItem.findMany({
      where: { saleOrderId: params.id },
    })
    const allDelivered = updatedItems.every(item => item.qtyDelivered >= item.qty)

    // Auto-advance status to 'delivered' if all lines are fully delivered
    let newStatus = order.status
    if (allDelivered) {
      newStatus = 'delivered'
      await prisma.saleOrder.update({
        where: { id: params.id },
        data: { status: 'delivered' },
      })
    }

    void broadcastSaleOrders()

    return NextResponse.json({
      ok: true,
      allDelivered,
      status: newStatus,
    })
  })
}
