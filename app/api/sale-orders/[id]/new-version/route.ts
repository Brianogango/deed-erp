import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { normalizeSaleStatus, isQuotationStage } from '@/lib/odoo-sales-flow'
import { saveStoreKeys } from '@/lib/server-store'

// Same roles that may create/edit a quotation — versioning is a quoting-stage
// action. Confirmed Sales Orders use the existing "Duplicate" action instead.
const NEW_VERSION_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep']

function mapSaleOrderToClient(order: any) {
  return {
    ...order,
    ref: order.orderNumber,
    customerId: order.clientId,
    customerName: order.client?.name ?? '',
    date: order.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : '',
    validUntil: order.validUntil ? new Date(order.validUntil).toISOString().slice(0, 10) : undefined,
    status: normalizeSaleStatus(order.status),
    total: Number(order.totalAmount ?? 0),
    taxTotal: Number(order.taxAmount ?? 0),
    subtotal: Number(order.subtotal ?? 0),
    lines: (order.items ?? []).map((item: any) => ({
      id: item.id,
      productId: item.productId ?? '',
      productName: item.description ?? '',
      description: item.description ?? '',
      qty: Number(item.qty ?? 0),
      unitPrice: Number(item.unitPrice ?? 0),
      taxRate: Number(item.taxRate ?? 0),
      subtotal: Number(item.lineTotal ?? 0),
      lineTotal: Number(item.lineTotal ?? 0),
      notes: item.notes ?? undefined,
    })),
  }
}

async function broadcastSaleOrders() {
  try {
    const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
  } catch {}
}

/** Strip a trailing "-V<n>" version suffix to recover the lineage's base document ref. */
function baseRef(ref: string): string {
  return ref.replace(/-V\d+$/i, '')
}

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!NEW_VERSION_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Your role cannot revise quotations' }, { status: 403 })
    }

    const source = await prisma.saleOrder.findUnique({
      where: { id: params.id },
      include: { items: true },
    })
    if (!source) return NextResponse.json({ error: 'Sale order not found' }, { status: 404 })
    if (!isQuotationStage(normalizeSaleStatus(source.status))) {
      return NextResponse.json(
        { error: 'Only quotations can be revised. Confirmed Sales Orders require a controlled Sales Order amendment' },
        { status: 409 },
      )
    }

    const rootId = source.versionGroupId ?? source.id
    const root = source.versionGroupId
      ? await prisma.saleOrder.findUnique({ where: { id: rootId }, select: { orderNumber: true } })
      : source
    if (!root) return NextResponse.json({ error: 'Version lineage root not found' }, { status: 500 })

    const siblings = await prisma.saleOrder.findMany({
      where: { OR: [{ id: rootId }, { versionGroupId: rootId }] },
      select: { id: true, versionNumber: true, status: true },
    })
    const maxVersion = Math.max(1, ...siblings.map(s => s.versionNumber ?? 1))
    const latest = siblings.find(s => (s.versionNumber ?? 1) === maxVersion)
    if (latest && latest.id !== source.id) {
      return NextResponse.json(
        { error: `Only the latest quotation revision can be revised. Open Revision ${maxVersion} first.` },
        { status: 409 },
      )
    }
    if (siblings.some(s => normalizeSaleStatus(s.status) === 'sale')) {
      return NextResponse.json(
        { error: 'Quotation revisions are closed because this quotation has already become a Sales Order. Use a controlled Sales Order amendment instead.' },
        { status: 409 },
      )
    }
    const nextVersion = maxVersion + 1
    const newOrderNumber = `${baseRef(root.orderNumber)}-V${nextVersion}`

    let created
    try {
      created = await prisma.$transaction(async tx => {
        await tx.saleOrder.update({
          where: { id: source.id },
          data: {
            locked: true,
            ...(!source.versionGroupId ? { versionGroupId: rootId } : {}),
          },
        })
        return tx.saleOrder.create({
          data: {
            orderNumber: newOrderNumber,
            clientId: source.clientId,
            status: 'quotation',
            orderDate: new Date(),
            validUntil: source.validUntil,
            deliveryDate: source.deliveryDate,
            subtotal: source.subtotal,
            taxAmount: source.taxAmount,
            discountAmount: source.discountAmount,
            totalAmount: source.totalAmount,
            notes: source.notes,
            pricelist: source.pricelist,
            pricelistId: source.pricelistId,
            currencyCode: source.currencyCode,
            baseCurrencyCode: source.baseCurrencyCode,
            exchangeRateToBase: source.exchangeRateToBase,
            salespersonId: source.salespersonId,
            salespersonName: source.salespersonName,
            salesTeam: source.salesTeam,
            customerRef: source.customerRef,
            invoiceAddress: source.invoiceAddress,
            deliveryAddress: source.deliveryAddress,
            createdById: session.user.id,
            versionNumber: nextVersion,
            versionGroupId: rootId,
            items: {
              create: source.items.map(item => ({
                productId: item.productId,
                description: item.description,
                qty: item.qty,
                unitPrice: item.unitPrice,
                taxRate: item.taxRate,
                lineTotal: item.lineTotal,
                notes: item.notes,
              })),
            },
          },
          include: { client: true, items: true },
        })
      })
    } catch (err: any) {
      // Unique (version_group_id, version_number) — another revision
      // request for the same lineage won the race between our read of
      // `siblings` and this create. Ask the caller to retry rather than
      // surfacing a raw 500 for what is really just a concurrency conflict.
      if (err?.code === 'P2002') {
        return NextResponse.json(
          { error: 'Someone else just created a new quotation revision — refresh and try again' },
          { status: 409 },
        )
      }
      throw err
    }

    void broadcastSaleOrders()
    return NextResponse.json(mapSaleOrderToClient(created), { status: 201 })
  })
}
