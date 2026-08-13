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
  isQuotationStage,
} from '@/lib/odoo-sales-flow'
import { enforceSaleOrderApprovals } from '@/lib/sales-approval-enforcement.server'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { validateSaleOrderLines } from '@/lib/sale-order-line-validation'
import { buildSaleOrderItemsNestedWrite } from '@/lib/sale-order-items-write'
import { saleOrderLinesFromBody } from '@/lib/sale-order-body-lines'
import { assertSaleOrderCreditOnConfirm } from '@/lib/sale-order-credit.server'
import { assertQuoteNotExpired } from '@/lib/sale-order-expiry'
import { calcSaleOrderTotals, calcSaleOrderTotalsFromPersistedLines } from '@/lib/sales/line-calc'
import { quotationPaymentTermsDays, serializeQuotationPaymentTerms } from '@/lib/sales/quotation-defaults'

/** Serialize blob rewrites so a slower soft/findMany cannot overwrite a newer Save. */
let broadcastSaleOrdersChain: Promise<void> = Promise.resolve()

async function broadcastSaleOrders() {
  broadcastSaleOrdersChain = broadcastSaleOrdersChain
    .catch(() => {})
    .then(async () => {
      const all = await prisma.saleOrder.findMany({
        include: { client: true, items: true },
        orderBy: { createdAt: 'desc' },
      })
      await saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
    })
  await broadcastSaleOrdersChain
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
  // Never leave raw Prisma `items` on the client row — PATCH used to prefer
  // that stale array over edited `lines` and resurrect deleted products.
  const { items: _prismaItems, client: _client, ...orderRest } = order ?? {}
  return {
    ...orderRest,
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
    acceptedAt: order.acceptedAt ? new Date(order.acceptedAt).toISOString() : undefined,
    acceptedById: order.acceptedById ?? undefined,
    confirmedAt: order.confirmedAt ? new Date(order.confirmedAt).toISOString() : undefined,
    total: Number(order.totalAmount ?? 0),
    taxTotal: Number(order.taxAmount ?? 0),
    subtotal: Number(order.subtotal ?? 0),
    discountAmount: Number(order.discountAmount ?? 0),
    amountPaid: Number(order.amountPaid ?? 0),
    lockVersion: Number(order.lockVersion ?? 0),
    lines: (order.items ?? []).map((item: any) => {
      const qty = Number(item.qty ?? 0)
      const productId = item.productId ?? ''
      const unitPrice = Number(item.unitPrice ?? 0)
      // Section headings were historically persisted as qty=0 rows without lineType.
      const lineType = qty === 0 && !productId && !(unitPrice > 0) ? 'section' as const : undefined
      return {
        id: item.id,
        productId,
        productName: item.description ?? '',
        description: item.description ?? '',
        qty,
        qtyDelivered: Number(item.qtyDelivered ?? 0),
        qtyInvoiced: Number(item.qtyInvoiced ?? 0),
        unitPrice,
        taxRate: Number(item.taxRate ?? 0),
        // See app/api/sale-orders/route.ts's mapSaleOrderToClient for why this
        // round-trips instead of being derived/omitted.
        discount: Number(item.discountPct ?? 0),
        discountPercent: Number(item.discountPct ?? 0),
        subtotal: Number(item.lineTotal ?? 0),
        lineTotal: Number(item.lineTotal ?? 0),
        serialIds: item.serialNumberId ? [item.serialNumberId] : [],
        notes: item.notes ?? undefined,
        ...(lineType ? { lineType } : {}),
      }
    }),
  }
}

async function buildSaleOrderUpdateData(body: any, existing: any) {
  const existingItems: any[] = existing?.items ?? []
  const data: Record<string, any> = {}

  // Only rewrite order_number when it actually changes (confirm allocates SO/…).
  // Draft line persists used to re-send `ref` every time; a stale QUO ref after
  // confirm collided with the unique constraint and silently dropped VAT edits.
  if (body.orderNumber !== undefined || body.ref !== undefined) {
    const nextNumber = body.orderNumber ?? body.ref
    if (nextNumber != null && String(nextNumber) !== String(existing.orderNumber ?? '')) {
      data.orderNumber = nextNumber
    }
  }
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
  if (body.acceptedAt !== undefined) data.acceptedAt = body.acceptedAt ? new Date(body.acceptedAt) : null
  if (body.acceptedById !== undefined) data.acceptedById = optionalUuid(body.acceptedById) ?? null
  if (body.pricelist !== undefined) data.pricelist = body.pricelist ?? null
  if (body.pricelistId !== undefined) data.pricelistId = optionalUuid(body.pricelistId) ?? null
  if (body.currencyCode !== undefined) data.currencyCode = body.currencyCode || 'KES'
  if (body.baseCurrencyCode !== undefined) data.baseCurrencyCode = body.baseCurrencyCode || 'KES'
  if (body.exchangeRateToBase !== undefined) data.exchangeRateToBase = Number(body.exchangeRateToBase) || 1
  if (body.salespersonId !== undefined) data.salespersonId = optionalUuid(body.salespersonId) ?? null
  if (body.salespersonName !== undefined) data.salespersonName = body.salespersonName ?? null
  if (body.salesTeam !== undefined) data.salesTeam = body.salesTeam ?? null
  if (body.paymentTermsDays !== undefined || body.paymentTerms !== undefined) {
    data.paymentTermsDays = quotationPaymentTermsDays({ paymentTermsDays: body.paymentTermsDays, paymentTerms: body.paymentTerms })
  }
  if (body.confirmedAt !== undefined) data.confirmedAt = body.confirmedAt ? new Date(body.confirmedAt) : null
  if (body.confirmedById !== undefined) data.confirmedById = optionalUuid(body.confirmedById) ?? null
  if (body.locked !== undefined) data.locked = Boolean(body.locked)
  if (body.customerRef !== undefined) data.customerRef = body.customerRef ?? null
  if (body.invoiceAddress !== undefined) data.invoiceAddress = body.invoiceAddress ?? null
  if (body.deliveryAddress !== undefined) data.deliveryAddress = body.deliveryAddress ?? null
  if (body.amountPaid !== undefined) data.amountPaid = Number(body.amountPaid ?? 0)
  if (body.notes !== undefined) data.notes = body.notes ?? null
  if (body.quoteId !== undefined) data.quoteId = optionalUuid(body.quoteId) ?? null

  if (body.clientId !== undefined || body.customerId !== undefined) {
    data.clientId = await resolveClientId(prisma, body.clientId ?? body.customerId, body)
  }

  const rawItems = saleOrderLinesFromBody(body)
  const itemsChanging = Array.isArray(rawItems)
  if (itemsChanging) {
    // Upsert by stable line id — avoid deleteMany+create UUID churn (Phase 5).
    const nested = buildSaleOrderItemsNestedWrite(rawItems, existingItems)
    data.items = Object.fromEntries(
      Object.entries(nested).filter(([, v]) => v !== undefined),
    )
  }

  // Header totals (subtotal / tax / discount / total) are ALWAYS recomputed
  // server-side — never trusted from the client body — whenever the lines or
  // the header discount actually change (P0 totals-integrity). A request that
  // touches neither leaves the stored totals untouched, since nothing that
  // could move them was submitted.
  const discountProvided = body.discountAmount !== undefined
  if (itemsChanging || discountProvided) {
    const headerDiscount = discountProvided ? body.discountAmount : existing?.discountAmount ?? 0
    const totals = itemsChanging
      ? calcSaleOrderTotals(rawItems, { headerDiscount })
      : calcSaleOrderTotalsFromPersistedLines(existingItems, headerDiscount)
    data.subtotal = totals.subtotal
    data.taxAmount = totals.taxAmount
    data.discountAmount = totals.discountAmount
    data.totalAmount = totals.totalAmount
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

  const rawItems = Array.isArray(body.lines) ? body.lines : body.items
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
    const transitionError = saleTransitionError(from, to, session.user.role, {
      previouslyConfirmed: Boolean(existing.confirmedAt),
    })
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
      const confirmDate = data.orderDate ?? existing.orderDate ?? new Date()
      const lock = await checkFiscalLock(confirmDate)
      if (!lock.ok) {
        return NextResponse.json({ error: lock.error }, { status: lock.status })
      }
      if (data.confirmedAt === undefined) data.confirmedAt = new Date()
      if (data.confirmedById === undefined) data.confirmedById = session.user.id
    }
    if (to === 'quotation_sent' && data.sentAt === undefined) {
      data.sentAt = new Date()
      data.sentById = session.user.id
    }
    // Reset to draft clears send/accept stamps so a later Send is treated as initial
    // (and edit locks stay tied to status, not a stale sentAt/acceptedAt).
    if (to === 'quotation' && (from === 'quotation_sent' || from === 'sale' || from === 'cancelled')) {
      if (data.sentAt === undefined) data.sentAt = null
      if (data.sentById === undefined) data.sentById = null
      if (data.sentTo === undefined) data.sentTo = null
      if (data.sentMessage === undefined) data.sentMessage = null
      if (data.acceptedAt === undefined) data.acceptedAt = null
      if (data.acceptedById === undefined) data.acceptedById = null
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
  // Resetting a locked confirmed order back to quotation ("Set to Quotation")
  // is a documented Finance/Director action (checked separately below) and
  // always unlocks as part of that same request — it must not be blocked
  // here just because the requester isn't specifically a director.
  const unlockingOnReset = to === 'quotation' && from === 'sale' && body.locked === false
  if (lockChangeRequested && !isDirector && !lockingOnConfirm && !unlockingOnReset) {
    return NextResponse.json({ error: 'Only a director can lock or unlock a confirmed order' }, { status: 403 })
  }
  // Sent quotations are commercially frozen until Reset to Draft (Odoo Sent ≠ Draft).
  // No director bypass — revise via Reset / New Version, not silent PATCH.
  const sentFreeze = from === 'quotation_sent' && to === 'quotation_sent'
  if (sentFreeze && hasCommercialChange(existing, body)) {
    return NextResponse.json(
      { error: 'Sent quotations are locked. Reset to draft first, then edit and save.' },
      { status: 409 },
    )
  }
  // Accepted quotations are an immutable commercial snapshot until Reset / Confirm.
  const acceptedFreeze = Boolean(existing.acceptedAt) && isQuotationStage(from) && to !== 'quotation' && to !== 'sale'
  if (acceptedFreeze && hasCommercialChange(existing, body)) {
    return NextResponse.json(
      { error: 'Accepted quotations are locked. Create a new version or reset to draft to change commercial terms.' },
      { status: 409 },
    )
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
  // Cancelled → quotation: if the SO was previously confirmed, Finance/Director only.
  if (to === 'quotation' && from === 'cancelled' && existing.confirmedAt) {
    const canReset = ['director', 'finance_officer'].includes(session.user.role)
    if (!canReset) {
      return NextResponse.json(
        { error: 'Only Finance or Director can reset a previously confirmed order to quotation' },
        { status: 403 },
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

    const rawItems = Array.isArray(body.lines) ? body.lines : body.items
    if (Array.isArray(rawItems)) {
      const lineError = validateSaleOrderLines(rawItems)
      if (lineError) {
        return NextResponse.json({ error: lineError }, { status: 400 })
      }
    }

    const data = await buildSaleOrderUpdateData(body, existing)
    const workflowError = await enforceSaleWorkflow(existing, body, data, session)
    if (workflowError) return workflowError

    const confirming = to === 'sale' && from !== 'sale'
    if (confirming) {
      const expiry = assertQuoteNotExpired(body.validUntil ?? existing.validUntil)
      if (!expiry.ok) {
        return NextResponse.json({ error: expiry.error }, { status: expiry.status })
      }
      const credit = await assertSaleOrderCreditOnConfirm({
        clientId: existing.clientId,
        // Use the server-recomputed total (not the client-declared one) so a
        // fabricated low total cannot sneak an order under the credit limit.
        orderTotal: Number(data.totalAmount ?? existing.totalAmount ?? 0),
        role: session.user.role,
      })
      if (!credit.ok) {
        return NextResponse.json({ error: credit.error }, { status: credit.status })
      }

      // Odoo "At Confirmation" vs "Manually": client may pass reserveStock:false
      // ("Confirm without reservation"). Default remains true so Confirm and
      // Reserve / single Confirm still allocate stock before the status flip.
      const shouldReserve = body.reserveStock !== false
      if (shouldReserve) {
        // Reserve stock BEFORE persisting the status flip (not after). If the
        // process crashes between these two steps, the order is left as an
        // unconfirmed quotation with an orphaned-but-recoverable reservation —
        // never a "confirmed" Sales Order silently holding zero reserved stock.
        try {
          const reserveResult = await reserveStockForSaleOrder(params.id, session.user.id)
          if (!reserveResult.ok) {
            return NextResponse.json(
              { error: reserveResult.error || 'Could not reserve stock for this order' },
              { status: 409 },
            )
          }
        } catch (err) {
          console.error('[sale-orders] reserveStockForSaleOrder threw:', err)
          return NextResponse.json(
            { error: 'Stock reservation failed — order was not confirmed. Try again or confirm without reservation.' },
            { status: 409 },
          )
        }
      }
    }

    data.lockVersion = nextLockVersion(existing.lockVersion)

    const order = await prisma.saleOrder.update({
      where: { id: params.id },
      data,
      include: { client: true, items: true },
    })

    // Cancel side-effects (confirm side-effects already happened above, before
    // the status flip was persisted).
    try {
      if (confirming) {
        await writeFinancialAudit({
          userId: session.user.id,
          action: 'confirm_sale_order',
          entityType: 'SaleOrder',
          entityId: params.id,
          oldValues: { status: from },
          newValues: { status: 'sale' },
        }).catch(() => {})
      }
      if (to === 'cancelled' && from !== 'cancelled') {
        // Route already wrote cancelled; release reservations without re-validating status.
        await prisma.stockReservation.updateMany({
          where: { saleOrderId: params.id, status: 'reserved' },
          data: { status: 'cancelled', releasedAt: new Date() },
        }).catch(err => console.error('[sale-orders] reservation release failed:', err))
        await writeFinancialAudit({
          userId: session.user.id,
          action: 'cancel_sale_order',
          entityType: 'SaleOrder',
          entityId: params.id,
          oldValues: { status: from },
          newValues: { status: 'cancelled' },
        }).catch(() => {})
      }
    } catch (err) {
      console.error('[sale-orders] confirm/cancel side-effect block failed:', err)
    }

    // Metadata-only PATCH (notes / validUntil / discount / …) must not rewrite
    // the whole deed_saleOrders blob from Prisma — that was racing draft line
    // edits in the browser and snapping removed products back onto the quote.
    // Soft auto-persist also skips broadcast; only explicit Save / status
    // changes rewrite the shared blob (after the write commits).
    const touchedLines = Array.isArray(body.lines) || Array.isArray(body.items)
    const skipBroadcast = body.skipBroadcast === true || body._softPersist === true
    if (!skipBroadcast && (touchedLines || confirming || to !== from)) {
      await broadcastSaleOrders()
    }
    // Phase E: RAM/SSD lines + host serial → sync linked draft reconfiguration.
    // Never mutates specs here — workshop completeWorkOrder owns that.
    let reconfiguration: unknown = null
    if (touchedLines || confirming) {
      try {
        const { syncReconfigurationFromSaleOrder } = await import('@/lib/reconfiguration/sales-bridge')
        reconfiguration = await syncReconfigurationFromSaleOrder({
          saleOrderId: params.id,
          userId: session.user.id,
        })
      } catch (err) {
        console.error('[sale-orders] reconfiguration sync failed:', err)
      }
    }

    const fresh = confirming
      ? await prisma.saleOrder.findUnique({
          where: { id: params.id },
          include: { client: true, items: true },
        })
      : order
    return NextResponse.json({
      ...mapSaleOrderToClient(fresh ?? order),
      ...(reconfiguration ? { reconfiguration } : {}),
    })
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!canWrite(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const order = await prisma.saleOrder.findUnique({
      where: { id: params.id },
      include: { items: true },
    })
    if (!order) return NextResponse.json({ error: 'Sale order not found' }, { status: 404 })

    const status = normalizeSaleStatus(order.status)
    if (status === 'cancelled') {
      return NextResponse.json({ ok: true, saleOrder: mapSaleOrderToClient(order) })
    }

    // Confirmed / progressed orders: never hard-delete (audit FIN-001).
    // Prefer Prisma invoices for parity (blob can lag); deliveries remain blob-backed.
    if (!isQuotationStage(status)) {
      const state = await loadAppState(['deed_deliveries'])
      const deliveries = (Array.isArray(state.deed_deliveries) ? state.deed_deliveries : [])
        .filter((d: any) => d?.saleOrderId === order.id)
      const invoices = await prisma.invoice.findMany({
        where: { saleOrderId: order.id },
        select: { status: true, amountPaid: true },
      }).catch(() => [])
      const blockers = saleOrderCancelBlockers({
        status,
        deliveries: deliveries.map((d: any) => ({ status: d.status })),
        invoices: invoices.map((i: any) => ({ status: i.status, amountPaid: Number(i.amountPaid) })),
      })
      const reason = blockers.length > 0
        ? `Confirmed sale orders cannot be deleted (${blockers.join('; ')})`
        : 'Confirmed sale orders cannot be deleted — cancel via sales workflow if allowed'
      return NextResponse.json({ error: reason }, { status: 409 })
    }

    const cancelled = await prisma.saleOrder.update({
      where: { id: order.id },
      data: { status: 'cancelled' },
      include: { client: true, items: true },
    })

    await writeFinancialAudit({
      userId: session.user.id,
      action: 'cancel_sale_order',
      entityType: 'sale_order',
      entityId: order.id,
      oldValues: { status: order.status, orderNumber: order.orderNumber },
      newValues: { status: 'cancelled' },
    })

    void broadcastSaleOrders()
    return NextResponse.json({ ok: true, saleOrder: mapSaleOrderToClient(cancelled) })
  })
}
