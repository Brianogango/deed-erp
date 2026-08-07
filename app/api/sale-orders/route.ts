import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid, resolveClientId } from '@/lib/legacy-compat'
import { isUUID } from '@/lib/utils'
import { saveStoreKeys } from '@/lib/server-store'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { enforceSaleOrderApprovals } from '@/lib/sales-approval-enforcement.server'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'
import { parsePaginationParams, paginatedResponse } from '@/lib/api-pagination'
import { validateSaleOrderLines } from '@/lib/sale-order-line-validation'
import { calcSaleOrderLineMoney, calcSaleOrderTotals } from '@/lib/sales/line-calc'
import { quotationPaymentTermsDays, serializeQuotationPaymentTerms } from '@/lib/sales/quotation-defaults'

async function broadcastSaleOrders() {
  try {
    const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
  } catch {}
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
    // paymentTermsDays is the durable column; the client historically reads a
    // display string. Reconstruct it so the value survives a server round-trip
    // instead of silently disappearing (it was never persisted before).
    paymentTerms: order.paymentTermsDays != null
      ? serializeQuotationPaymentTerms(Number(order.paymentTermsDays))
      : undefined,
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
      unitPrice: Number(item.unitPrice ?? 0),
      taxRate: Number(item.taxRate ?? 0),
      subtotal: Number(item.lineTotal ?? 0),
      lineTotal: Number(item.lineTotal ?? 0),
      serialIds: item.serialNumberId ? [item.serialNumberId] : [],
      notes: item.notes ?? undefined,
      qtyDelivered: Number(item.qtyDelivered ?? 0),
      qtyInvoiced: Number(item.qtyInvoiced ?? 0),
    })),
  }
}

function mapSaleOrderItems(lines: any[]) {
  return lines.map((item: any) => {
    const qty = Math.max(0, Number(item.qty ?? 1) || 0)
    // lineTotal is recomputed from qty × unitPrice × (1 − discount%), never
    // trusted from the client (P0 totals-integrity — matches PUT/PATCH).
    const money = calcSaleOrderLineMoney({ ...item, qty })
    return {
      productId: optionalUuid(item.productId),
      description: item.description ?? item.productName ?? 'Item',
      qty,
      unitPrice: money.unitPrice,
      taxRate: money.taxRate,
      lineTotal: money.lineTotal,
      notes: item.notes ?? null,
      serialNumberId: optionalUuid(item.serialNumberId ?? item.serialIds?.[0]),
      qtyInvoiced: Math.max(0, Number(item.qtyInvoiced ?? 0) || 0),
    }
  })
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const q = searchParams.get('q')
    const { page, limit, skip, sort, order } = parsePaginationParams(searchParams, {
      defaultSort: 'createdAt',
      allowedSorts: ['createdAt', 'updatedAt', 'orderDate', 'totalAmount', 'orderNumber', 'status'],
    })

    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { orderNumber: { contains: q, mode: 'insensitive' as const } },
              { client: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    }

    const [total, orders] = await Promise.all([
      prisma.saleOrder.count({ where }),
      prisma.saleOrder.findMany({
        where,
        include: {
          client: true,
          items: true,
        },
        orderBy: { [sort ?? 'createdAt']: order },
        skip,
        take: limit,
      }),
    ])

    return NextResponse.json(
      paginatedResponse(orders.map(mapSaleOrderToClient), total, page, limit),
    )
  })
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()

    const status = normalizeSaleStatus(body.status)
    const approvalCheck = await enforceSaleOrderApprovals({
      body,
      sessionUserId: session.user.id,
      sessionRole: session.user.role,
      fromStatus: 'quotation',
      toStatus: status,
    })
    if (!approvalCheck.ok) {
      return NextResponse.json(
        { error: approvalCheck.error, requiredRoles: approvalCheck.requiredRoles },
        { status: approvalCheck.status },
      )
    }

    const rawItems: any[] = body.items ?? body.lines ?? []
    const lineError = validateSaleOrderLines(rawItems)
    if (lineError) {
      return NextResponse.json({ error: lineError }, { status: 400 })
    }

    // Idempotent create: the client generates its own id before syncing, so a
    // retried/duplicated request (network retry, double-submit that reused
    // the same in-flight object) returns the already-created order instead of
    // erroring on the primary-key conflict or, worse, creating a duplicate.
    if (isUUID(body.id)) {
      const already = await prisma.saleOrder.findUnique({
        where: { id: body.id },
        include: { client: true, items: true },
      })
      if (already) {
        return NextResponse.json(mapSaleOrderToClient(already), { status: 200 })
      }
    }

    const clientId = await resolveClientId(prisma, body.clientId ?? body.customerId, body)
    let orderNumber = body.orderNumber ?? body.ref

    if (!orderNumber) {
      // Quotations and confirmed orders run separate sequences (QUO vs SO).
      const status = normalizeSaleStatus(body.status)
      orderNumber = await getNextDocNumber(status === 'sale' || status === 'cancelled' ? 'sale_order' : 'quotation')
    }

    // Totals are recomputed from the line items server-side (never trusted
    // from the client) — mirrors lib/finance-invoice.ts's invoice totals.
    const totals = calcSaleOrderTotals(rawItems, { headerDiscount: body.discountAmount })

    const order = await prisma.saleOrder.create({
      data: {
        ...(isUUID(body.id) ? { id: body.id } : {}),
        orderNumber,
        quotationRef: body.quotationRef ?? null,
        proformaRef: body.proformaRef ?? null,
        clientId,
        createdById: session.user.id,
        status: normalizeSaleStatus(body.status),
        orderDate: new Date(body.orderDate ?? body.date ?? Date.now()),
        deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        discountAmount: totals.discountAmount,
        totalAmount: totals.totalAmount,
        amountPaid: Number(body.amountPaid ?? 0),
        notes: body.notes ?? null,
        customerRef: body.customerRef ?? null,
        invoiceAddress: body.invoiceAddress ?? null,
        deliveryAddress: body.deliveryAddress ?? null,
        pricelist: body.pricelist ?? null,
        currencyCode: body.currencyCode ?? 'KES',
        baseCurrencyCode: body.baseCurrencyCode ?? 'KES',
        exchangeRateToBase: Number(body.exchangeRateToBase ?? 1) || 1,
        salespersonId: optionalUuid(body.salespersonId),
        salespersonName: body.salespersonName ?? null,
        salesTeam: body.salesTeam ?? null,
        paymentTermsDays: body.paymentTermsDays !== undefined || body.paymentTerms !== undefined
          ? quotationPaymentTermsDays({ paymentTermsDays: body.paymentTermsDays, paymentTerms: body.paymentTerms })
          : null,
        quoteId: optionalUuid(body.quoteId),
        items: {
          create: mapSaleOrderItems(rawItems),
        },
      },
      include: { client: true, items: true },
    })

    void broadcastSaleOrders()
    return NextResponse.json(mapSaleOrderToClient(order), { status: 201 })
  })
}
