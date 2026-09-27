import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { normalizePermissionRole } from '@/lib/auth/authorization'
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
import { quotationPaymentTermsDays } from '@/lib/sales/quotation-defaults'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'

async function broadcastSaleOrders() {
  try {
    const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
    void saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
  } catch {}
}

function normalizeOptionalProducts(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).map((item: any) => ({
    id: String(item?.id ?? '').slice(0, 120),
    productId: String(item?.productId ?? '').slice(0, 120),
    productName: String(item?.productName ?? '').slice(0, 300),
    qty: Math.max(0, Number(item?.qty) || 0),
    unitPrice: Math.max(0, Number(item?.unitPrice) || 0),
  })).filter(item => item.productName && item.qty > 0)
}

function mapSaleOrderItems(lines: any[], knownProductIds?: Set<string>) {
  return lines.map((item: any) => {
    if (item?.lineType === 'section' || (Number(item?.qty ?? 0) === 0 && !item?.productId && !(Number(item?.unitPrice) > 0))) {
      return {
        productId: null,
        description: item.description ?? item.productName ?? 'Section',
        qty: 0,
        unitPrice: 0,
        taxRate: 0,
        discountPct: 0,
        lineTotal: 0,
        notes: item.notes ?? null,
        serialNumberId: null,
        qtyInvoiced: 0,
      }
    }
    const qty = Math.max(0, Number(item.qty ?? 1) || 0)
    // lineTotal is recomputed from qty × unitPrice × (1 − discount%), never
    // trusted from the client (P0 totals-integrity — matches PUT/PATCH).
    const money = calcSaleOrderLineMoney({ ...item, qty })
    const candidate = optionalUuid(item.productId)
    // Drop productIds that are not in Prisma yet (optimistic local-only products).
    // Keeping a description-only line lets the quotation persist instead of
    // failing the whole create on sale_order_items_product_id_fkey.
    const productId = candidate && (!knownProductIds || knownProductIds.has(candidate))
      ? candidate
      : null
    return {
      productId,
      description: item.description ?? item.productName ?? 'Item',
      qty,
      unitPrice: money.unitPrice,
      taxRate: money.taxRate,
      discountPct: money.discountPct,
      lineTotal: money.lineTotal,
      notes: item.notes ?? null,
      serialNumberId: optionalUuid(item.serialNumberId ?? item.serialIds?.[0]),
      qtyInvoiced: Math.max(0, Number(item.qtyInvoiced ?? 0) || 0),
    }
  })
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const role = normalizePermissionRole(session.user.role)
    if (!role || !['director', 'admin_officer', 'finance_officer', 'sales_rep', 'technical_lead'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const q = searchParams.get('q')
    const { page, limit, skip, sort, order } = parsePaginationParams(searchParams, {
      defaultSort: 'createdAt',
      allowedSorts: ['createdAt', 'updatedAt', 'orderDate', 'totalAmount', 'orderNumber', 'status'],
    })

    const searchFilter = q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: 'insensitive' as const } },
            { client: { name: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}

    const ownershipFilter = role === 'sales_rep'
      ? {
          OR: [
            { createdById: session.user.id },
            { salespersonId: session.user.id },
          ],
        }
      : {}

    const where = {
      ...(status ? { status } : {}),
      ...(q || role === 'sales_rep'
        ? { AND: [q ? searchFilter : {}, ownershipFilter] }
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
    const role = normalizePermissionRole(session.user.role)
    if (!role || !['director', 'admin_officer', 'finance_officer', 'sales_rep', 'technical_lead'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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

    const rawItems: any[] = (Array.isArray(body.lines) ? body.lines : body.items) ?? []
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

    const productIds = [...new Set(
      rawItems
        .map((item: any) => optionalUuid(item.productId))
        .filter((id: string | undefined): id is string => Boolean(id)),
    )]
    const knownProducts = productIds.length
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })
      : []
    const knownProductIds = new Set(knownProducts.map(p => p.id))

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
        amountPaid: 0,
        notes: body.notes ?? null,
        termsAndConditions: body.termsAndConditions ? String(body.termsAndConditions).slice(0, 20000) : null,
        optionalProducts: normalizeOptionalProducts(body.optionalProducts),
        customerRef: body.customerRef ? String(body.customerRef).slice(0, 120) : null,
        invoiceAddress: body.invoiceAddress ?? null,
        deliveryAddress: body.deliveryAddress ?? null,
        pricelist: body.pricelist ?? null,
        currencyCode: body.currencyCode ?? 'KES',
        baseCurrencyCode: body.baseCurrencyCode ?? 'KES',
        exchangeRateToBase: Number(body.exchangeRateToBase ?? 1) || 1,
        salespersonId: role === 'sales_rep' ? session.user.id : optionalUuid(body.salespersonId),
        salespersonName: body.salespersonName ? String(body.salespersonName).slice(0, 120) : null,
        salesTeam: body.salesTeam ? String(body.salesTeam).slice(0, 120) : null,
        paymentTermsDays: body.paymentTermsDays !== undefined || body.paymentTerms !== undefined
          ? quotationPaymentTermsDays({ paymentTermsDays: body.paymentTermsDays, paymentTerms: body.paymentTerms })
          : null,
        quoteId: optionalUuid(body.quoteId),
        items: {
          create: mapSaleOrderItems(rawItems, knownProductIds),
        },
      },
      include: { client: true, items: true },
    })

    void broadcastSaleOrders()
    return NextResponse.json(mapSaleOrderToClient(order), { status: 201 })
  })
}
