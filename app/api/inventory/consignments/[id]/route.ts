import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { resolvePOLineProducts } from '@/lib/purchase/po-prisma-sync'
import { computePOTotals, mapPOItemsForCreate, mirrorPurchaseOrder } from '@/lib/purchase/po-api-shared'
import { purchaseConsignment, returnConsignment } from '@/lib/inventory/consignment'
import { CONSIGNMENT_WRITE_ROLES, consignmentFromRow, consignmentPurchaseOrderBody } from '@/lib/inventory/consignment-server'

/**
 * The two ways a consigned device leaves the register.
 *
 * { action: 'purchase', productId, price, date } — Deed buys it. Raises a draft
 *   purchase order to the vendor for this one unit; the device becomes stock
 *   only when that order is received on a GRN, like any other purchase.
 * { action: 'return', date, notes? } — the vendor collected it unsold.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withApiErrorHandling(async () => {
    const actor = await requireRole(CONSIGNMENT_WRITE_ROLES)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const row = await prisma.consignmentDevice.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Device not found.' }, { status: 404 })
    const device = consignmentFromRow(row)
    const date = String(body.date ?? '').trim()

    if (body.action === 'return') {
      const result = returnConsignment(device, { at: date, notes: body.notes as string })
      if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 })
      const updated = await prisma.consignmentDevice.update({
        where: { id },
        data: { status: 'returned', returnedAt: new Date(`${date}T00:00:00Z`), notes: result.value.notes },
      })
      return NextResponse.json({ device: consignmentFromRow(updated) })
    }

    if (body.action === 'purchase') {
      const productId = String(body.productId ?? '').trim()
      const product = productId
        ? await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } })
        : null
      if (!product) {
        return NextResponse.json({ error: 'Choose the catalogue product this device is, so it can go on the purchase order.' }, { status: 422 })
      }
      const price = Number(body.price)
      if (!Number.isFinite(price) || price <= 0) {
        return NextResponse.json({ error: 'Enter the price agreed with the vendor.' }, { status: 422 })
      }
      const result = purchaseConsignment(device, { at: date, price })
      if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 422 })

      const poBody = consignmentPurchaseOrderBody({ device, productId: product.id, productName: product.name, price, date })
      const items = await resolvePOLineProducts(mapPOItemsForCreate(poBody.lines))
      const totals = computePOTotals(items)
      const poNumber = await getNextDocNumber('purchase_order')

      const { order, updated } = await prisma.$transaction(async tx => {
        // Re-read inside the transaction: two people pressing Purchase at once
        // must not raise two orders for one machine.
        const live = await tx.consignmentDevice.findUnique({ where: { id } })
        if (!live || live.status !== 'at_shop') throw Object.assign(new Error('This device is no longer at the shop.'), { status: 409 })
        const order = await tx.purchaseOrder.create({
          data: {
            poNumber,
            clientId: device.vendorId,
            status: 'draft',
            orderDate: new Date(`${date}T00:00:00Z`),
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            totalAmount: totals.totalAmount,
            notes: poBody.notes,
            createdById: actor.id,
            items: { create: items },
          } as any,
          include: { vendor: true, items: { include: { product: true } } },
        })
        const updated = await tx.consignmentDevice.update({
          where: { id },
          data: {
            status: 'purchased',
            purchasedAt: new Date(`${date}T00:00:00Z`),
            purchasePrice: price,
            purchaseOrderId: order.id,
            productId: product.id,
            productName: device.productName || product.name,
          },
        })
        return { order, updated }
      })
      // The purchase screens still read the purchase-order list from the store.
      await mirrorPurchaseOrder(order).catch(() => {})
      return NextResponse.json({ device: consignmentFromRow(updated, order.poNumber), purchaseOrder: { id: order.id, ref: order.poNumber } })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  })
}
