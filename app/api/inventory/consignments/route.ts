import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { recordConsignmentReceipt } from '@/lib/inventory/consignment'
import { CONSIGNMENT_READ_ROLES, CONSIGNMENT_WRITE_ROLES, consignmentFromRow } from '@/lib/inventory/consignment-server'

/**
 * Vendor devices held at the shop and not yet bought.
 *
 * GET  — the register, plus the vendors and catalogue products its forms need.
 * POST — book a device in.
 *
 * A custody register only: nothing here touches stock or the ledger.
 */

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireRole(CONSIGNMENT_READ_ROLES)
    const [rows, vendors, products] = await Promise.all([
      prisma.consignmentDevice.findMany({ orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }], take: 1000 }),
      prisma.client.findMany({ where: { isActive: true }, select: { id: true, name: true, isVendor: true }, orderBy: { name: 'asc' } }),
      prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true, sku: true }, orderBy: { name: 'asc' } }),
    ])
    const poIds = Array.from(new Set(rows.map(r => r.purchaseOrderId).filter((id): id is string => !!id)))
    const orders = poIds.length
      ? await prisma.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, poNumber: true } })
      : []
    const refById = new Map(orders.map(o => [o.id, o.poNumber]))
    return NextResponse.json({
      devices: rows.map(row => consignmentFromRow(row, row.purchaseOrderId ? refById.get(row.purchaseOrderId) : null)),
      // Vendors first: a consignment normally comes from a supplier, but any
      // contact may leave machines, and booking one in marks it as a vendor.
      vendors: vendors.sort((a, b) => Number(b.isVendor) - Number(a.isVendor)).map(v => ({ id: v.id, name: v.name, isVendor: v.isVendor })),
      products,
    })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(CONSIGNMENT_WRITE_ROLES)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>

    const vendorId = String(body.vendorId ?? '').trim()
    const vendor = vendorId
      ? await prisma.client.findUnique({ where: { id: vendorId }, select: { id: true, name: true, isVendor: true } })
      : null
    if (vendorId && !vendor) return NextResponse.json({ error: 'That vendor was not found.' }, { status: 404 })

    const productId = String(body.productId ?? '').trim() || null
    const product = productId
      ? await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } })
      : null

    const open = await prisma.consignmentDevice.findMany({ where: { status: 'at_shop' } })
    const receipt = recordConsignmentReceipt({
      vendorId,
      vendorName: vendor?.name,
      assetId: body.assetId as string,
      serialNumber: body.serialNumber as string,
      productName: (body.productName as string) || product?.name,
      conditionGrade: body.conditionGrade as string,
      receivedAt: body.receivedAt as string,
      notes: body.notes as string,
    }, open.map(row => consignmentFromRow(row)), randomUUID())
    if (!receipt.ok) return NextResponse.json({ error: receipt.reason }, { status: 422 })

    const device = receipt.value
    try {
      const created = await prisma.consignmentDevice.create({
        data: {
          id: device.id,
          vendorId: device.vendorId,
          vendorName: device.vendorName,
          assetId: device.assetId,
          serialNumber: device.serialNumber,
          productId: product?.id ?? null,
          productName: device.productName,
          conditionGrade: device.conditionGrade,
          receivedAt: new Date(`${device.receivedAt}T00:00:00Z`),
          status: 'at_shop',
          notes: device.notes,
          createdById: actor.id,
        },
      })
      if (vendor && !vendor.isVendor) {
        await prisma.client.update({ where: { id: vendor.id }, data: { isVendor: true } })
      }
      return NextResponse.json({ device: consignmentFromRow(created) }, { status: 201 })
    } catch (error) {
      // The database refuses a second open row for the same serial even if two
      // people book it in at the same moment.
      if ((error as { code?: string })?.code === 'P2002' || /uq_consignment_open_serial/.test(String(error))) {
        return NextResponse.json({ error: `${device.serialNumber} is already booked in.` }, { status: 409 })
      }
      throw error
    }
  })
}
