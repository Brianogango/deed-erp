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
  canReverseConfirmedSale,
} from '@/lib/odoo-sales-flow'
import { enforceSaleOrderApprovals } from '@/lib/sales-approval-enforcement.server'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { checkFiscalLock } from '@/lib/fiscal-lock.server'
import { validateSaleOrderLines } from '@/lib/sale-order-line-validation'
import { buildSaleOrderItemsNestedWrite } from '@/lib/sale-order-items-write'
import {
  hasCommercialChange,
  normalizeOptionalProducts,
} from '@/lib/sales/sale-order-commercial-change'
import { saleOrderLinesFromBody } from '@/lib/sale-order-body-lines'
import { assertSaleOrderCreditOnConfirm } from '@/lib/sale-order-credit.server'
import { assertQuoteNotExpired } from '@/lib/sale-order-expiry'
import { extractRepairRefFromText } from '@/lib/repair/sale-order-link'
import { calcSaleOrderTotals, calcSaleOrderTotalsFromPersistedLines } from '@/lib/sales/line-calc'
import { quotationPaymentTermsDays } from '@/lib/sales/quotation-defaults'
import { canTrimFulfillmentQty, isFulfillmentQtyTrim } from '@/lib/sales/fulfillment-trim'
import { notifySaleOrderConfirmed } from '@/lib/notifications/business-events'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'
import { reopenAsQuotationData, repairRevisionAccessError, repairRevisionStatusError } from '@/lib/sales/repair-quote-revision'

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
const REPAIR_WRITE_ROLES = [...WRITE_ROLES]

function isRepairLinked(record: any) {
  return Boolean(
    record?.repairId
    || record?.repairRef
    || record?.source === 'repair'
    || extractRepairRefFromText(record?.notes)
    || /repair/i.test(String(record?.notes ?? '')),
  )
}

function normalizeSaleOrderStatus(status: unknown) {
  if (typeof status !== 'string' || status.trim() === '') return undefined
  return normalizeSaleStatus(status)
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
  if (body.termsAndConditions !== undefined) data.termsAndConditions = body.termsAndConditions ? String(body.termsAndConditions).slice(0, 20000) : null
  if (body.optionalProducts !== undefined) data.optionalProducts = normalizeOptionalProducts(body.optionalProducts)
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
      repairLinked: isRepairLinked(existing) || isRepairLinked(body),
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
  // is a documented Finance / Admin Officer / Director action (checked
  // separately below) and always unlocks as part of that same request — it
  // must not be blocked here just because the requester isn't a director.
  const unlockingOnReset = to === 'quotation' && from === 'sale' && body.locked === false
  if (lockChangeRequested && !isDirector && !lockingOnConfirm && !unlockingOnReset) {
    return NextResponse.json({ error: 'Only a director can lock or unlock a confirmed order' }, { status: 403 })
  }
  // Sent quotations are commercially frozen until Reset to Draft (Odoo Sent ≠ Draft).
  // No director bypass — revise via Reset / Revise Quotation, not silent PATCH.
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
      { error: 'Accepted quotations are locked. Revise the quotation or reset to draft to change commercial terms.' },
      { status: 409 },
    )
  }
  // Phase C: confirmed sales orders freeze commercial fields for everyone
  // except directors (even when salesLockConfirmed did not set locked=true).
  // Inventory may still fold ordered qty down to delivered ("No Backorder").
  const confirmedFreeze = from === 'sale' && to === 'sale'
  const fulfillmentTrim =
    confirmedFreeze
    && isFulfillmentQtyTrim(existing, body)
    && canTrimFulfillmentQty(session.user.role)
  if ((existing.locked || confirmedFreeze) && !isDirector && to !== 'quotation' && hasCommercialChange(existing, body) && !fulfillmentTrim) {
    return NextResponse.json(
      { error: existing.locked
        ? 'This order is locked. Ask a director to unlock it before changing commercial fields.'
        : 'Confirmed sale orders are locked for commercial edits. Ask a director to unlock before changing prices or quantities.' },
      { status: 409 },
    )
  }
  // Reset to quotation requires Finance / Admin Officer / Director and cancel
  // blockers when confirmed.
  if (to === 'quotation' && from === 'sale') {
    if (!canReverseConfirmedSale(session.user.role)) {
      return NextResponse.json({ error: 'Only Finance, Admin Officer, or Director can reset a sale order to quotation' }, { status: 403 })
    }
    const blockers = await saleOrderBlockersFor(existing.id)
    if (blockers.length > 0) {
      return NextResponse.json(
        { error: `Cannot reset to quotation: ${blockers.join('; ')}` },
        { status: 409 },
      )
    }
  }
  // Cancelled → quotation: if the SO was previously confirmed, same reverse gate.
  if (to === 'quotation' && from === 'cancelled' && existing.confirmedAt) {
    if (!canReverseConfirmedSale(session.user.role)) {
      return NextResponse.json(
        { error: 'Only Finance, Admin Officer, or Director can reset a previously confirmed order to quotation' },
        { status: 403 },
      )
    }
  }
  return null
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const order = await prisma.saleOrder.findUnique({
      where: { id: resolvedParams.id },
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

/**
 * A revised repair quote reaching the repair's sale order. The repair is the
 * source, so the ordinary Sales locks (technicians may not edit orders;
 * confirmed and sent orders are frozen) do not apply — the repair has just
 * gone back to awaiting the client's approval, and so does its order. What
 * still stops it: the actor must be on that repair, and nothing may have been
 * delivered or invoiced against the order.
 */
async function applyRepairQuoteRevision(id: string, body: any, session: { user: { id: string; role: string } }) {
  const existing = await prisma.saleOrder.findUnique({ where: { id }, include: { items: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const state = await loadAppState(['deed_repairs_v2'])
  const repairs = Array.isArray(state.deed_repairs_v2) ? state.deed_repairs_v2 as any[] : []
  const repair = repairs.find(r => r?.id === body.repairId)
  const accessError = repairRevisionAccessError({
    role: String(session.user.role),
    userId: session.user.id,
    repair,
    order: { id: existing.id, notes: existing.notes },
  })
  if (accessError) return NextResponse.json({ error: accessError }, { status: 403 })

  if (existing.versionGroupId) {
    const lineage = await prisma.saleOrder.findMany({
      where: { OR: [{ id: existing.versionGroupId }, { versionGroupId: existing.versionGroupId }] },
      select: { id: true, versionNumber: true, orderNumber: true },
    })
    const maxRevision = Math.max(1, ...lineage.map(row => row.versionNumber ?? 1))
    const latest = lineage.find(row => (row.versionNumber ?? 1) === maxRevision)
    if (latest && latest.id !== existing.id) {
      return NextResponse.json(
        { error: `The repair points at revision ${existing.versionNumber ?? 1} of its quotation; Sales has revision ${maxRevision} (${latest.orderNumber}). Update that one in Sales.` },
        { status: 409 },
      )
    }
  }

  const from = normalizeSaleStatus(existing.status)
  const blockers = from === 'sale' ? await saleOrderBlockersFor(existing.id) : []
  const statusError = repairRevisionStatusError(from, blockers)
  if (statusError) return NextResponse.json({ error: statusError }, { status: 409 })

  const rawItems = Array.isArray(body.lines) ? body.lines : body.items
  if (Array.isArray(rawItems)) {
    const lineError = validateSaleOrderLines(rawItems)
    if (lineError) return NextResponse.json({ error: lineError }, { status: 400 })
  }

  // Status and lock stamps are the server's call here, never the body's.
  const { status: _status, locked: _locked, confirmedAt: _c, confirmedById: _cb, ...commercial } = body
  const data = await buildSaleOrderUpdateData(commercial, existing)
  Object.assign(data, reopenAsQuotationData(from))
  data.lockVersion = nextLockVersion(existing.lockVersion)

  const order = await prisma.saleOrder.update({ where: { id }, data, include: { client: true, items: true } })
  if (from === 'sale') {
    await prisma.stockReservation.updateMany({
      where: { saleOrderId: id, status: 'reserved' },
      data: { status: 'cancelled', releasedAt: new Date() },
    }).catch(err => console.error('[sale-orders] reservation release failed:', err))
  }
  await writeFinancialAudit({
    userId: session.user.id,
    action: 'repair_quote_revision',
    entityType: 'SaleOrder',
    entityId: id,
    oldValues: { status: from, totalAmount: Number(existing.totalAmount) },
    newValues: { status: order.status, totalAmount: Number(order.totalAmount), repairRef: repair?.ref },
  }).catch(() => {})
  await broadcastSaleOrders()
  return NextResponse.json(mapSaleOrderToClient(order))
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    const body = await request.json()
    if (body?.repairRevision === true) return applyRepairQuoteRevision(resolvedParams.id, body, session)
    const trimRole = canTrimFulfillmentQty(session.user.role) && (body.fulfillmentTrim === true || body.fulfillmentTrim === 'true')
    const allowed = isRepairLinked(body)
      ? REPAIR_WRITE_ROLES.includes(session.user.role)
      : canWrite(session.user.role) || trimRole
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const existing = await prisma.saleOrder.findUnique({
      where: { id: resolvedParams.id },
      include: { items: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const validTrim = isFulfillmentQtyTrim(existing, body)
    if (trimRole && !canWrite(session.user.role) && !validTrim) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!canAccessRecord(session.user.role, 'sale_order', {
      createdByUserId: existing.createdById,
      salespersonId: existing.salespersonId,
    }, session.user.id) && !(trimRole && validTrim)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Older quotation revisions are immutable audit snapshots. Enforce this
    // server-side so deep links or crafted requests cannot edit or confirm them.
    if (existing.versionGroupId) {
      const lineage = await prisma.saleOrder.findMany({
        where: { OR: [{ id: existing.versionGroupId }, { versionGroupId: existing.versionGroupId }] },
        select: { id: true, versionNumber: true },
      })
      const maxRevision = Math.max(1, ...lineage.map(row => row.versionNumber ?? 1))
      const latest = lineage.find(row => (row.versionNumber ?? 1) === maxRevision)
      if (latest && latest.id !== existing.id) {
        return NextResponse.json(
          { error: `Revision ${existing.versionNumber ?? 1} is read-only. Open Revision ${maxRevision} to edit, send, or confirm the quotation.` },
          { status: 409 },
        )
      }
    }

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
      const repairLinked = isRepairLinked(body) || isRepairLinked(existing)
      const expiry = assertQuoteNotExpired(body.validUntil ?? existing.validUntil, { skip: repairLinked })
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
      // Repair billing is post-work invoicing — parts were already consumed
      // in the workshop, so do not reserve unless the client asks.
      const shouldReserve = repairLinked ? body.reserveStock === true : body.reserveStock !== false
      if (shouldReserve) {
        // Reserve stock BEFORE persisting the status flip (not after). If the
        // process crashes between these two steps, the order is left as an
        // unconfirmed quotation with an orphaned-but-recoverable reservation —
        // never a "confirmed" Sales Order silently holding zero reserved stock.
        try {
          const reserveResult = await reserveStockForSaleOrder(resolvedParams.id, session.user.id)
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
      where: { id: resolvedParams.id },
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
          entityId: resolvedParams.id,
          oldValues: { status: from },
          newValues: { status: 'sale' },
        }).catch(() => {})
      }
      if (to === 'cancelled' && from !== 'cancelled') {
        // Route already wrote cancelled; release reservations without re-validating status.
        await prisma.stockReservation.updateMany({
          where: { saleOrderId: resolvedParams.id, status: 'reserved' },
          data: { status: 'cancelled', releasedAt: new Date() },
        }).catch(err => console.error('[sale-orders] reservation release failed:', err))
        await writeFinancialAudit({
          userId: session.user.id,
          action: 'cancel_sale_order',
          entityType: 'SaleOrder',
          entityId: resolvedParams.id,
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

    if (confirming) await notifySaleOrderConfirmed(resolvedParams.id, session.user.id)

    const fresh = confirming
      ? await prisma.saleOrder.findUnique({
          where: { id: resolvedParams.id },
          include: { client: true, items: true },
        })
      : order
    return NextResponse.json(mapSaleOrderToClient(fresh ?? order))
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return PUT(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!canWrite(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const order = await prisma.saleOrder.findUnique({
      where: { id: resolvedParams.id },
      include: { items: true },
    })
    if (!order) return NextResponse.json({ error: 'Sale order not found' }, { status: 404 })
    if (!canAccessRecord(session.user.role, 'sale_order', {
      createdByUserId: order.createdById,
      salespersonId: order.salespersonId,
    }, session.user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
