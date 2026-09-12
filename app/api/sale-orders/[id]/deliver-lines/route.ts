/**
 * POST /api/sale-orders/:id/deliver-lines
 *
 * Updates the qtyDelivered for each order line item of a confirmed Sales
 * Order. The order status never changes here: Odoo-style, delivery progress
 * lives on the delivery records and per-line quantities, not the SO status.
 *
 * Body: { lines: Array<{ id: string; qtyDelivered: number }> }
 */
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { saveStoreKeys } from '@/lib/server-store'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { ensureConfirmedSaleOrderForFulfillment } from '@/lib/sale-order-confirm-heal.server'
import { resolveRouteParams, type RouteParams } from '@/lib/route-params'

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
        qtyInvoiced: Number(item.qtyInvoiced ?? 0),
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

export async function POST(request: NextRequest, { params }: { params: RouteParams<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!DELIVER_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await resolveRouteParams(params)

    const body = await request.json()
    const lineUpdates: Array<{ id: string; qtyDelivered: number }> = body.lines ?? []

    if (!Array.isArray(lineUpdates) || lineUpdates.length === 0) {
      return NextResponse.json({ error: 'lines array is required' }, { status: 400 })
    }

    // Fetch the order and verify it is a confirmed Sales Order
    let order = await prisma.saleOrder.findUnique({
      where: { id },
      include: { items: true },
    })
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (normalizeSaleStatus(order.status) !== 'sale') {
      const healed = await ensureConfirmedSaleOrderForFulfillment(order)
      if (!healed) {
        return NextResponse.json(
          {
            error:
              'Order must be a confirmed Sales Order to record delivery. Re-confirm the quotation, then try Validate again.',
          },
          { status: 422 },
        )
      }
      order = healed
    }

    const confirmed = order
    // Monotonic fulfillment: never lower qtyDelivered via this endpoint
    // (stale client PATCHes / races must not wipe a real delivery back to 0).
    // Clamp to ordered qty. Returns use a dedicated after-sales path.
    await Promise.all(
      lineUpdates.map(({ id, qtyDelivered }) => {
        const existing = confirmed.items.find(item => item.id === id)
        if (!existing) return Promise.resolve()
        const demand = Math.max(0, Number(existing.qty) || 0)
        const current = Math.max(0, Number(existing.qtyDelivered) || 0)
        const incoming = Math.max(0, Number(qtyDelivered ?? 0))
        const next = Math.min(demand, Math.max(current, incoming))
        return prisma.saleOrderItem.update({
          where: { id },
          data: { qtyDelivered: next },
        })
      })
    )

    // Report whether all lines are fully delivered; the SO status itself
    // stays "sale" — delivery state is tracked on the delivery records.
    const updatedItems = await prisma.saleOrderItem.findMany({
      where: { saleOrderId: id },
    })
    const allDelivered = updatedItems.every(item => item.qtyDelivered >= item.qty)

    void broadcastSaleOrders()

    return NextResponse.json({
      ok: true,
      allDelivered,
      status: normalizeSaleStatus(confirmed.status),
    })
  })
}
