import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canAccessRecord } from '@/lib/auth/authorization'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { reserveStockForSaleOrder } from '@/lib/inventory/stock-transactions'
import {
  normalizeSaleStatus,
  saleTransitionError,
  saleOrderCancelBlockers,
} from '@/lib/odoo-sales-flow'
import { enforceSaleOrderApprovals } from '@/lib/sales-approval-enforcement.server'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'

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
    pricelist: order.pricelist ?? undefined,
    pricelistId: order.pricelistId ?? undefined,
    currencyCode: order.currencyCode ?? 'KES',
    baseCurrencyCode: order.baseCurrencyCode ?? 'KES',
    exchangeRateToBase: Number(order.exchangeRateToBase ?? 1) || 1,
    salespersonId: order.salespersonId ?? undefined,
    salespersonName: order.salespersonName ?? undefined,
    salesTeam: order.salesTeam ?? undefined,
    sentMessage: order.sentMessage ?? undefined,
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
    lockVersion: Number(order.lockVersion ?? 0),
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
  if (body.sentMessage !== undefined) data.sentMessage = body.sentMessage ?? null
  if (body.pricelist !== undefined) data.pricelist = body.pricelist ?? null
  if (body.pricelistId !== undefined) data.pricelistId = optionalUuid(body.pricelistId) ?? null
  if (body.currencyCode !== undefined) data.currencyCode = body.currencyCode || 'KES'
  if (body.baseCurrencyCode !== undefined) data.baseCurrencyCode = body.baseCurrencyCode || 'KES'
  if (body.exchangeRateToBase !== undefined) data.exchangeRateToBase = Number(body.exchangeRateToBase) || 1
  if (body.salespersonId !== undefined) data.salespersonId = optionalUuid(body.salespersonId) ?? null
  if (body.salespersonName !== undefined) data.salespersonName = body.salespersonName ?? null
  if (body.salesTeam !== undefined) data.salesTeam = body.salesTeam ?? null
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

// ─── Server-side workflow enforcement ────────────────────────────────────────
// The client store applies the same rules for UX, but the API is the actual
// gate: a crafted PATCH cannot skip states, cancel past dependent records,
// or edit a locked order.

/** Commercial content of a line for lock comparison (fulfilment fields ignored). */
function commercialLineKey(line: any) {
  return [
    line.productId ?? '',
    line.description ?? line.productName ?? '',
    Number(line.qty ?? 0),
    Number(line.unitPrice ?? 0),
    Number(line.taxRate ?? 0),
    Number(line.lineTotal ?? line.subtotal ?? 0),
  ].join('|')
}

function hasCommercialChange(existing: any, body: any): boolean {
  const changedScalar = (
    (body.clientId !== undefined || body.customerId !== undefined) &&
      String(body.clientId ?? body.customerId ?? '') !== String(existing.clientId ?? '')
  ) || (
    (body.subtotal !== undefined) && Number(body.subtotal) !== Number(existing.subtotal)
  ) || (
    (body.totalAmount !== undefined || body.total !== undefined) &&
      Number(body.totalAmount ?? body.total) !== Number(existing.totalAmount)
  ) || (
    (body.taxAmount !== undefined || body.taxTotal !== undefined) &&
      Number(body.taxAmount ?? body.taxTotal) !== Number(existing.taxAmount)
  ) || (
    body.discountAmount !== undefined && Number(body.discountAmount) !== Number(existing.discountAmount)
  )
  if (changedScalar) return true

  const rawItems = body.items ?? body.lines
  if (!Array.isArray(rawItems)) return false
  const requested = rawItems
    .filter((l: any) => l.lineType !== 'section')
    .map(commercialLineKey).sort()
  const current = (existing.items ?? []).map(commercialLineKey).sort()
  return requested.length !== current.length || requested.some((key: string, i: number) => key !== current[i])
}

async function saleOrderBlockersFor(orderId: string): Promise<string[]> {
  const invoices = await prisma.invoice.findMany({
    where: { saleOrderId: orderId },
    select: { status: true, amountPaid: true },
  })
  let deliveries: Array<{ status: string }> = []
  try {
    // loadAppState returns parsed JSON values.
    const state = await loadAppState(['deed_deliveries'])
    const all = state.deed_deliveries
    deliveries = Array.isArray(all) ? all.filter((d: any) => d.saleOrderId === orderId) : []
  } catch {}
  return saleOrderCancelBlockers({
    status: 'sale',
    deliveries,
    invoices: invoices.map(i => ({ status: String(i.status), amountPaid: Number(i.amountPaid) })),
  })
}

/**
 * Returns an error response when the requested update violates the Odoo-style
 * workflow, otherwise null. `data` may be augmented with server-side stamps
 * (confirmation/sent metadata) for transitions the client did not stamp.
 */
async function enforceSaleWorkflow(
  existing: any,
  body: any,
  data: Record<string, any>,
  session: { user: { id: string; role: string } },
): Promise<NextResponse | null> {
  const from = normalizeSaleStatus(existing.status)
  const to = body.status !== undefined ? normalizeSaleStatus(body.status) : from

  if (to !== from) {
    const transitionError = saleTransitionError(from, to, session.user.role)
    if (transitionError) {
      return NextResponse.json({ error: transitionError }, { status: 409 })
    }
    if (to === 'cancelled' && from === 'sale') {
      const blockers = await saleOrderBlockersFor(existing.id)
      if (blockers.length > 0) {
        return NextResponse.json(
          { error: `Cannot cancel: ${blockers.join('; ')}` },
          { status: 409 },
        )
      }
    }
    // Stamp transitions server-side when the client did not.
    if (to === 'sale') {
      if (data.confirmedAt === undefined) data.confirmedAt = new Date()
      if (data.confirmedById === undefined) data.confirmedById = session.user.id
    }
    if (to === 'quotation_sent' && data.sentAt === undefined) {
      data.sentAt = new Date()
      data.sentById = session.user.id
    }
  }

  // Lock rules: only a director may lock/unlock, and a locked order's
  // commercial fields are frozen for everyone else (fulfilment progress like
  // qtyDelivered/qtyInvoiced updates stays allowed).
  const isDirector = session.user.role === 'director'
  const lockChangeRequested = body.locked !== undefined && Boolean(body.locked) !== Boolean(existing.locked)
  // Auto-locking during confirmation (Lock Confirmed Sales) is part of the
  // confirm action itself and does not require director rights.
  const lockingOnConfirm = to === 'sale' && from !== 'sale' && body.locked === true
  if (lockChangeRequested && !isDirector && !lockingOnConfirm) {
    return NextResponse.json({ error: 'Only a director can lock or unlock a confirmed order' }, { status: 403 })
  }
  // Phase C: confirmed sales orders freeze commercial fields for everyone
  // except directors (even when salesLockConfirmed did not set locked=true).
  const confirmedFreeze = from === 'sale' && to === 'sale'
  if ((existing.locked || confirmedFreeze) && !isDirector && to !== 'quotation' && hasCommercialChange(existing, body)) {
    return NextResponse.json(
      { error: existing.locked
        ? 'This order is locked. Ask a director to unlock it before changing commercial fields.'
        : 'Confirmed sale orders are locked for commercial edits. Ask a director to unlock before changing prices or quantities.' },
      { status: 409 },
    )
  }
  // Reset to quotation requires Finance/Director and cancel blockers when confirmed.
  if (to === 'quotation' && from === 'sale') {
    const canReset = ['director', 'finance_officer'].includes(session.user.role)
    if (!canReset) {
      return NextResponse.json({ error: 'Only Finance or Director can reset a sale order to quotation' }, { status: 403 })
    }
    const blockers = await saleOrderBlockersFor(existing.id)
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: `Cannot reset to quotation: ${blockers.join('; ')}` },
        { status: 409 },
      )
    }
  }
  return null
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const order = await prisma.saleOrder.findUnique({
      where: { id: params.id },
      include: { client: true, items: true },
    })
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canAccessRecord(session.user.role, 'sale_order', {
      createdByUserId: order.createdById,
      salespersonId: order.salespersonId,
    }, session.user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json(mapSaleOrderToClient(order))
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    const allowed = isRepairLinked(body) ? REPAIR_WRITE_ROLES.includes(session.user.role) : canWrite(session.user.role)
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const existing = await prisma.saleOrder.findUnique({
      where: { id: params.id },
      include: { items: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const expectedVersion = readExpectedVersion(body)
    if (lockVersionMismatch(existing.lockVersion, expectedVersion)) {
      return NextResponse.json(
        { error: 'Record was modified by another user', lockVersion: existing.lockVersion },
        { status: 409 },
      )
    }

    const from = normalizeSaleStatus(existing.status)
    const to = body.status !== undefined ? normalizeSaleStatus(body.status) : from
    const approvalCheck = await enforceSaleOrderApprovals({
      body,
      existing,
      sessionUserId: session.user.id,
      sessionRole: session.user.role,
      fromStatus: from,
      toStatus: to,
    })
    if (!approvalCheck.ok) {
      return NextResponse.json(
        { error: approvalCheck.error, requiredRoles: approvalCheck.requiredRoles },
        { status: approvalCheck.status },
      )
    }

    const data = await buildSaleOrderUpdateData(body)
    const workflowError = await enforceSaleWorkflow(existing, body, data, session)
    if (workflowError) return workflowError

    data.lockVersion = nextLockVersion(existing.lockVersion)

    const order = await prisma.saleOrder.update({
      where: { id: params.id },
      data,
      include: { client: true, items: true },
    })

    const from = normalizeSaleStatus(existing.status)
    const to = body.status !== undefined ? normalizeSaleStatus(body.status) : from

    // Prefer SaleOrderService for confirm/cancel side-effects (reservation release + audit).
    // Workflow already enforced above; service is idempotent on status.
    try {
      const { SaleOrderService } = await import('@/lib/services/sale-order.service')
      if (to === 'sale' && from !== 'sale') {
        await SaleOrderService.confirm(params.id, session.user.id, session.user.role).catch(() => {})
        const reserveResult = await reserveStockForSaleOrder(params.id, session.user.id)
        if (!reserveResult.ok) {
          console.error('[sale-orders] reserveStockForSaleOrder failed:', reserveResult.error)
        }
      }
      if (to === 'cancelled' && from !== 'cancelled') {
        await SaleOrderService.cancel(params.id, session.user.id).catch(() => {})
      }
    } catch { /* service optional during soak */ }

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
