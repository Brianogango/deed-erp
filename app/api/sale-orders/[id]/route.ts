import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { saveStoreKeys } from '@/lib/server-store'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'

async function broadcastSaleOrders() {
  try {
    const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
  } catch {}
}

// technical_lead: repair-quote revisions PATCH the linked sale order totals.
const WRITE_ROLES = ['director', 'admin_officer', 'finance_officer', 'sales_rep', 'technical_lead']
// Repair staff update repair-linked sale orders via quote revisions in the
// Repair module; those syncs must not be rejected or the SO goes stale.
const REPAIR_WRITE_ROLES = [...WRITE_ROLES, 'technician']

function isRepairLinked(body: any) {
  return Boolean(body?.repairId || body?.repairRef || /repair/i.test(String(body?.notes ?? '')))
}

function normalizeSaleOrderStatus(status: unknown) {
  if (typeof status !== 'string' || status.trim() === '') return undefined
  return normalizeSaleStatus(status)
}

function mapSaleOrderToClient(order: any) {
  return {
    ...order,
    ref: order.orderNumber,
    quotationRef: order.quotationRef ?? undefined,
    proformaRef: order.proformaRef ?? undefined,
    customerId: order.clientId,
    customerName: order.client?.name ?? '',
    date: order.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : '',
    deliveryDate: order.deliveryDate ? new Date(order.deliveryDate).toISOString().slice(0, 10) : undefined,
    validUntil: order.validUntil ? new Date(order.validUntil).toISOString().slice(0, 10) : undefined,
    status: normalizeSaleStatus(order.status),
    sentAt: order.sentAt ? new Date(order.sentAt).toISOString() : undefined,
    confirmedAt: order.confirmedAt ? new Date(order.confirmedAt).toISOString() : undefined,
    total: Number(order.totalAmount ?? 0),
    taxTotal: Number(order.taxAmount ?? 0),
    subtotal: Number(order.subtotal ?? 0),
    discountAmount: Number(order.discountAmount ?? 0),
    amountPaid: Number(order.amountPaid ?? 0),
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
  }
}

function mapSaleOrderItems(lines: any[]) {
  return lines.map((item: any) => ({
    productId: optionalUuid(item.productId),
    description: item.description ?? item.productName ?? 'Item',
    qty: Number(item.qty ?? 1),
    qtyDelivered: Number(item.qtyDelivered ?? 0),
    qtyInvoiced: Number(item.qtyInvoiced ?? 0),
    unitPrice: Number(item.unitPrice ?? 0),
    taxRate: Number(item.taxRate ?? 0),
    lineTotal: Number(item.lineTotal ?? item.subtotal ?? 0),
    notes: item.notes ?? null,
    serialNumberId: optionalUuid(item.serialNumberId ?? item.serialIds?.[0]),
  }))
}

async function buildSaleOrderUpdateData(body: any) {
  const data: Record<string, any> = {}

  if (body.orderNumber !== undefined || body.ref !== undefined) data.orderNumber = body.orderNumber ?? body.ref
  if (body.quotationRef !== undefined) data.quotationRef = body.quotationRef ?? null
  if (body.proformaRef !== undefined) data.proformaRef = body.proformaRef ?? null
  if (body.status !== undefined) data.status = normalizeSaleOrderStatus(body.status)
  if (body.orderDate !== undefined || body.date !== undefined) data.orderDate = new Date(body.orderDate ?? body.date)
  if (body.deliveryDate !== undefined) data.deliveryDate = body.deliveryDate ? new Date(body.deliveryDate) : null
  if (body.validUntil !== undefined) data.validUntil = body.validUntil ? new Date(body.validUntil) : null
  if (body.sentAt !== undefined) data.sentAt = body.sentAt ? new Date(body.sentAt) : null
  if (body.sentById !== undefined) data.sentById = optionalUuid(body.sentById) ?? null
  if (body.sentTo !== undefined) data.sentTo = body.sentTo ?? null
  if (body.confirmedAt !== undefined) data.confirmedAt = body.confirmedAt ? new Date(body.confirmedAt) : null
  if (body.confirmedById !== undefined) data.confirmedById = optionalUuid(body.confirmedById) ?? null
  if (body.locked !== undefined) data.locked = Boolean(body.locked)
  if (body.customerRef !== undefined) data.customerRef = body.customerRef ?? null
  if (body.invoiceAddress !== undefined) data.invoiceAddress = body.invoiceAddress ?? null
  if (body.deliveryAddress !== undefined) data.deliveryAddress = body.deliveryAddress ?? null
  if (body.subtotal !== undefined) data.subtotal = Number(body.subtotal ?? 0)
  if (body.taxAmount !== undefined || body.taxTotal !== undefined) data.taxAmount = Number(body.taxAmount ?? body.taxTotal ?? 0)
  if (body.discountAmount !== undefined) data.discountAmount = Number(body.discountAmount ?? 0)
  if (body.totalAmount !== undefined || body.total !== undefined) data.totalAmount = Number(body.totalAmount ?? body.total ?? 0)
  if (body.amountPaid !== undefined) data.amountPaid = Number(body.amountPaid ?? 0)
  if (body.notes !== undefined) data.notes = body.notes ?? null
  if (body.quoteId !== undefined) data.quoteId = optionalUuid(body.quoteId) ?? null

  if (body.clientId !== undefined || body.customerId !== undefined) {
    data.clientId = await resolveClientId(prisma, body.clientId ?? body.customerId, body)
  }

  const rawItems = body.items ?? body.lines
  if (Array.isArray(rawItems)) {
    data.items = {
      deleteMany: {},
      create: mapSaleOrderItems(rawItems),
    }
  }

  return data
}

function canWrite(role: string) {
  return WRITE_ROLES.includes(role)
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const order = await prisma.saleOrder.findUnique({
      where: { id: params.id },
      include: { client: true, items: true },
    })
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(mapSaleOrderToClient(order))
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    const allowed = isRepairLinked(body) ? REPAIR_WRITE_ROLES.includes(session.user.role) : canWrite(session.user.role)
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const data = await buildSaleOrderUpdateData(body)
    const order = await prisma.saleOrder.update({
      where: { id: params.id },
      data,
      include: { client: true, items: true },
    })
    void broadcastSaleOrders()
    return NextResponse.json(mapSaleOrderToClient(order))
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!canWrite(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await prisma.saleOrder.delete({ where: { id: params.id } })
    void broadcastSaleOrders()
    return NextResponse.json({ ok: true })
  })
}
