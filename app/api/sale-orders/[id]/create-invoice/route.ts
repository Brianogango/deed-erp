import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import {
  deliveredByProductFromDoneDeliveries,
  hasValidatedDeliveryForInvoice,
  invoiceableQty,
  normalizeSaleStatus,
  type InvoicePolicy,
} from '@/lib/odoo-sales-flow'
import { allocateDeliveredQtyToOrderLines } from '@/lib/delivery-prepare'
import { resolveInvoicePolicy } from '@/lib/sales/invoice-policy'
import {
  computeDownPaymentAmount,
  downPaymentDeductionForFinal,
  isDownPaymentMode,
  normalizeCreateInvoiceMode,
  saleOrderDownPaymentBase,
  sumUnappliedDownPayments,
  type CreateInvoiceMode,
} from '@/lib/sales/down-payment'
import { mapDbInvoiceItemsToClientLines } from '@/lib/finance-invoice'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { ensureConfirmedSaleOrderForFulfillment } from '@/lib/sale-order-confirm-heal.server'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

/**
 * Atomic SO → draft customer invoice.
 * Locks line qtyInvoiced on the Prisma sale order items in the same transaction
 * (except down-payment invoices, which do not consume product qtyInvoiced).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const orderId = params.id

    // Optional body:
    //   { mode, percent?, amount?, lines?: [{ itemId, qty }] }
    // mode: regular | down_payment_percent | down_payment_fixed | final
    const body = await request.json().catch(() => null) as {
      mode?: string
      percent?: number
      amount?: number
      lines?: Array<{ itemId?: string; qty?: number }>
    } | null
    const mode: CreateInvoiceMode = normalizeCreateInvoiceMode(body?.mode)
    // An empty array (no explicit selection) falls back to full auto-invoice
    // rather than being treated as "invoice nothing" — only a non-empty
    // lines array is a real partial-invoice request.
    const overrideQtyByItemId = Array.isArray(body?.lines) && body!.lines!.length > 0
      ? new Map(
          body!.lines!
            .filter((l): l is { itemId: string; qty: number } => typeof l?.itemId === 'string' && l.itemId.length > 0)
            .map(l => [l.itemId, Math.max(0, Number(l.qty) || 0)] as const),
        )
      : null

    let order = await prisma.saleOrder.findUnique({
      where: { id: orderId },
      include: { client: true, items: true },
    })
    if (!order) return NextResponse.json({ error: 'Sale order not found' }, { status: 404 })

    if (normalizeSaleStatus(order.status) !== 'sale') {
      const healed = await ensureConfirmedSaleOrderForFulfillment(order)
      if (!healed) {
        return NextResponse.json({ error: 'Only a confirmed Sales Order can be invoiced' }, { status: 409 })
      }
      order = healed
    }
    if (normalizeSaleStatus(order.status) !== 'sale') {
      return NextResponse.json({ error: 'Only a confirmed Sales Order can be invoiced' }, { status: 409 })
    }

    const confirmed = order

    const state = await loadAppState(['deed_invoices', 'deed_deliveries'])
    const blobInvoices = Array.isArray(state.deed_invoices) ? (state.deed_invoices as any[]) : []
    const priorDownPayments = sumUnappliedDownPayments(
      [
        ...blobInvoices,
        // Prisma rows win for durability when columns exist.
      ],
      orderId,
    )
    // Prefer Prisma down-payment rows when the column is available.
    let prismaPriorDown = 0
    try {
      const downs = await prisma.invoice.findMany({
        where: {
          saleOrderId: orderId,
          isDownPayment: true,
          downPaymentAppliedToId: null,
          status: { notIn: ['cancelled'] as any },
        },
        select: { totalAmount: true },
      })
      prismaPriorDown = downs.reduce((s, d) => s + Math.max(0, Math.round(Number(d.totalAmount) || 0)), 0)
    } catch {
      prismaPriorDown = priorDownPayments
    }
    const unappliedDownPayments = Math.max(priorDownPayments, prismaPriorDown)

    // ── Down-payment invoice (deposit) — no product qtyInvoiced bump ────────
    if (isDownPaymentMode(mode)) {
      const orderTotal = saleOrderDownPaymentBase({
        totalAmount: confirmed.totalAmount,
        subtotal: confirmed.subtotal,
        taxAmount: confirmed.taxAmount,
        discountAmount: confirmed.discountAmount,
      })
      const computed = computeDownPaymentAmount({
        mode,
        orderTotal,
        percent: body?.percent,
        amount: body?.amount,
        priorDownPayments: unappliedDownPayments,
      })
      if (!computed.ok) {
        return NextResponse.json({ error: computed.error }, { status: 409 })
      }

      const amount = computed.amount
      const taxRate = 16
      const lineSubtotal = Math.round(amount / (1 + taxRate / 100))
      const lineTax = amount - lineSubtotal
      const draftRef = await getNextDocNumber('invoice').catch(() => `DRAFT-INV-${Date.now().toString().slice(-6)}`)
      const dueDate = new Date(Date.now() + 7 * 86400000)
      const subject = computed.percent != null
        ? `[Down Payment ${computed.percent}%]`
        : `[Down Payment fixed]`
      const notes = `${subject} on ${confirmed.orderNumber}`

      const result = await prisma.$transaction(async (tx) => {
        return tx.invoice.create({
          data: {
            invoiceNumber: draftRef,
            status: 'draft',
            clientId: confirmed.clientId,
            saleOrderId: confirmed.id,
            invoiceDate: new Date(),
            dueDate,
            subject,
            subtotal: lineSubtotal,
            taxAmount: lineTax,
            discountAmount: 0,
            totalAmount: amount,
            amountPaid: 0,
            isDownPayment: true,
            downPaymentPercent: computed.percent,
            notes,
            createdById: actor.id,
            items: {
              create: [{
                description: `Down payment on ${confirmed.orderNumber}`,
                qty: 1,
                unitPrice: lineSubtotal,
                taxRate,
                lineSubtotal,
                lineTax,
                lineTotal: amount,
              }],
            },
          },
          include: { items: true, client: true },
        })
      })

      const date = new Date().toISOString().slice(0, 10)
      const clientInvoice = {
        id: result.id,
        ref: result.invoiceNumber,
        type: 'customer_invoice' as const,
        status: 'draft' as const,
        partnerId: confirmed.clientId,
        partnerName: confirmed.client?.name ?? '',
        date,
        dueDate: dueDate.toISOString().slice(0, 10),
        lines: mapDbInvoiceItemsToClientLines(result.items),
        subtotal: lineSubtotal,
        taxTotal: lineTax,
        discountAmount: 0,
        total: amount,
        amountPaid: 0,
        saleOrderId: confirmed.id,
        isDownPayment: true,
        downPaymentPercent: computed.percent,
        notes,
        subject,
      }
      try {
        const invoices = [...blobInvoices]
        invoices.unshift(clientInvoice)
        await saveStoreKeys({ deed_invoices: JSON.stringify(invoices) })
      } catch { /* Prisma authoritative */ }

      await writeFinancialAudit({
        userId: actor.id,
        action: 'create_down_payment_invoice',
        entityType: 'invoice',
        entityId: result.id,
        newValues: { saleOrderId: orderId, ref: result.invoiceNumber, total: amount, mode },
      })

      return NextResponse.json({ ok: true, invoice: clientInvoice })
    }

    const deliveries = Array.isArray(state.deed_deliveries)
      ? state.deed_deliveries as Array<{
          saleOrderId?: string
          status?: string
          deliveryNoteGeneratedAt?: string | null
          lines?: Array<{
            productId?: string
            qty?: number
            qtyDone?: number
            serialIds?: string[] | null
          }> | null
        }>
      : []
    const hasValidatedDelivery = hasValidatedDeliveryForInvoice(deliveries, orderId)

    // Product invoicing policy (Ordered vs Delivered quantities).
    const productIds = [...new Set(
      (confirmed.items ?? []).map(i => i.productId).filter((id): id is string => !!id),
    )]
    const products = productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, invoicePolicy: true, trackStock: true },
        })
      : []
    const productById = new Map(products.map(p => [p.id, p]))
    const policyForItem = (item: { productId?: string | null }): InvoicePolicy => {
      const product = item.productId ? productById.get(item.productId) : undefined
      return resolveInvoicePolicy({
        productPolicy: product?.invoicePolicy,
        trackStock: product?.trackStock,
      })
    }

    // Heal qtyDelivered from Done delivery lines (qtyDone / serials) when a
    // legacy Done DN left Prisma delivered=0 — otherwise Create Invoice is blocked
    // for Delivered-policy lines.
    // Allocate FIFO across duplicate product rows so each line does not receive
    // the full product total (that overstated invoiceable qty).
    const healedFromDeliveries = deliveredByProductFromDoneDeliveries(deliveries, orderId)
    const itemsForHeal = (confirmed.items ?? []).map(item => ({
      id: item.id,
      productId: item.productId ?? undefined,
      qty: Number(item.qty) || 0,
      qtyDelivered: Math.max(
        Number(item.qtyDelivered) || 0,
        item.serialNumberId ? 1 : 0,
      ),
    }))
    const allocated = allocateDeliveredQtyToOrderLines(itemsForHeal, healedFromDeliveries, 'max')
    const healedById = new Map(allocated.map(row => [row.id, Number(row.qtyDelivered) || 0]))
    const healedItems = await Promise.all((confirmed.items ?? []).map(async item => {
      const current = Number(item.qtyDelivered) || 0
      const healed = healedById.get(item.id) ?? current
      if (healed > current) {
        await prisma.saleOrderItem.update({
          where: { id: item.id },
          data: { qtyDelivered: healed },
        })
        return { ...item, qtyDelivered: healed }
      }
      return item
    }))

    let invoiceable = healedItems.map(item => {
      const invoicePolicy = policyForItem(item)
      const maxQty = invoiceableQty({
        qty: Number(item.qty) || 0,
        qtyDelivered: Number(item.qtyDelivered) || 0,
        qtyInvoiced: Number(item.qtyInvoiced) || 0,
        invoicePolicy,
      })
      // No override map: full auto-invoice (existing one-click behavior).
      // Override map present but this item absent: 0 (not selected this round).
      const qty = overrideQtyByItemId === null
        ? maxQty
        : Math.min(maxQty, overrideQtyByItemId.get(item.id) ?? 0)
      return { item, qty, invoicePolicy }
    }).filter(entry => entry.qty > 0)

    // Delivered-policy lines need a validated DN; Ordered-policy lines do not.
    // If only delivery-policy qty remains and nothing is validated, give a clear error.
    const deliveryPolicyPending = invoiceable.filter(e => e.invoicePolicy === 'delivery')
    if (deliveryPolicyPending.length > 0 && !hasValidatedDelivery) {
      const orderOnly = invoiceable.filter(e => e.invoicePolicy === 'order')
      if (orderOnly.length === 0) {
        return NextResponse.json({
          error: 'Validate the delivery before creating an invoice',
        }, { status: 409 })
      }
      // Mixed policies: invoice ordered-qty lines now; leave delivery lines for later.
      invoiceable = orderOnly
    }

    if (invoiceable.length === 0) {
      const anyDeliveryPolicy = healedItems.some(item => policyForItem(item) === 'delivery')
      return NextResponse.json({
        error: overrideQtyByItemId
          ? 'Select at least one line with a quantity greater than zero to invoice'
          : anyDeliveryPolicy && !hasValidatedDelivery
            ? 'Validate the delivery before creating an invoice'
            : 'Nothing to invoice — quantities are already invoiced or not yet eligible',
      }, { status: 409 })
    }

    const lines = invoiceable.map(({ item, qty }) => {
      const unit = Number(item.unitPrice) || 0
      const taxRate = Number(item.taxRate) || 0
      const itemQty = Number(item.qty) || 0
      // item.lineTotal already bakes in this line's discountPct — recomputing
      // unit x qty here would silently drop it and over-invoice a discounted
      // line. Prorate the ORIGINAL discounted lineTotal by the fraction of
      // the line's quantity being invoiced this round (qty === itemQty on a
      // full/one-click invoice, so this is exact there too).
      const fullLineTotal = Number(item.lineTotal) || Math.round(unit * itemQty)
      const lineTotal = itemQty > 0
        ? Math.round((fullLineTotal * qty) / itemQty)
        : Math.round(unit * qty)
      return {
        description: `${item.description ?? 'Item'} ×${qty}`,
        qty,
        // Effective (post-discount) unit price for this invoice line — kept
        // consistent with lineTotal/qty so downstream unitPrice x qty math
        // (e.g. PDF rendering) reconciles instead of re-introducing the
        // discount gap.
        unitPrice: qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : unit,
        taxRate,
        lineTotal,
        productId: item.productId ?? undefined,
        serialNumberId: item.serialNumberId ?? undefined,
      }
    })

    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0)
    const taxAmount = lines.reduce((s, l) => s + Math.round(l.lineTotal * (l.taxRate || 0) / 100), 0)

    // Prorate the sale order's header discount across this invoice run so a
    // discounted confirmed SO is never over-invoiced. On a partial invoice,
    // only the discount share proportional to the invoiced subtotal applies —
    // the remaining share still applies to whatever is invoiced later.
    const orderSubtotalForDiscount = (confirmed.items ?? []).reduce(
      (s, item) => s + Number(item.lineTotal ?? 0), 0,
    )
    const headerDiscount = Math.max(0, Number(confirmed.discountAmount ?? 0))
    const proratedHeaderDiscount = orderSubtotalForDiscount > 0 && headerDiscount > 0
      ? Math.min(subtotal + taxAmount, Math.round((headerDiscount * subtotal) / orderSubtotalForDiscount))
      : 0
    // Final invoice deducts unapplied down payments (Odoo deposit deduction).
    const downDeduction = mode === 'final'
      ? downPaymentDeductionForFinal({
          invoiceSubtotal: subtotal,
          invoiceTax: taxAmount,
          headerDiscount: proratedHeaderDiscount,
          priorDownPayments: unappliedDownPayments,
        })
      : 0
    const discountAmount = proratedHeaderDiscount + downDeduction
    const totalAmount = Math.max(0, subtotal + taxAmount - discountAmount)
    if (totalAmount < 1) {
      return NextResponse.json({ error: 'Invoice total must be at least KES 1' }, { status: 400 })
    }

    const draftRef = await getNextDocNumber('invoice').catch(() => `DRAFT-INV-${Date.now().toString().slice(-6)}`)
    const paymentTermsDays = Number(confirmed.paymentTermsDays)
    const dueDate = new Date(Date.now() + (Number.isFinite(paymentTermsDays) && paymentTermsDays >= 0 ? paymentTermsDays : 30) * 86400000)
    const invoiceNotes = downDeduction > 0
      ? `Created from ${confirmed.orderNumber} · Down payments deducted: KES ${downDeduction.toLocaleString()}`
      : `Created from ${confirmed.orderNumber}`

    const result = await prisma.$transaction(async (tx) => {
      // Re-read items inside the transaction to reduce race window
      const fresh = await tx.saleOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      })
      if (!fresh) throw new Error('Sale order disappeared')

      for (const { item, qty, invoicePolicy } of invoiceable) {
        const live = fresh.items.find(i => i.id === item.id)
        if (!live) throw new Error('Sale order line missing')
        const still = invoiceableQty({
          qty: Number(live.qty) || 0,
          qtyDelivered: Number(live.qtyDelivered) || 0,
          qtyInvoiced: Number(live.qtyInvoiced) || 0,
          invoicePolicy,
        })
        if (still < qty) throw new Error('Invoiceable quantity changed — retry')
        // Guarded atomic update: the WHERE clause re-checks qtyInvoiced still
        // equals what we just read, evaluated by Postgres as a single
        // statement. If a concurrent request already bumped this line
        // (TOCTOU race), `count` is 0 and the whole transaction rolls back
        // instead of silently double-invoicing the same delivered quantity.
        const updated = await tx.saleOrderItem.updateMany({
          where: { id: live.id, qtyInvoiced: live.qtyInvoiced },
          data: { qtyInvoiced: Number(live.qtyInvoiced || 0) + qty },
        })
        if (updated.count === 0) throw new Error('Invoiceable quantity changed — retry')
      }

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: draftRef,
          status: 'draft',
          clientId: confirmed.clientId,
          saleOrderId: confirmed.id,
          invoiceDate: new Date(),
          dueDate,
          subtotal,
          taxAmount,
          discountAmount,
          totalAmount,
          amountPaid: 0,
          notes: invoiceNotes,
          createdById: actor.id,
          items: {
            create: lines.map(l => {
              const lineTax = Math.round(l.lineTotal * (l.taxRate || 0) / 100)
              return {
                description: l.description,
                qty: l.qty,
                unitPrice: l.unitPrice,
                taxRate: l.taxRate,
                lineSubtotal: l.lineTotal,
                lineTax,
                lineTotal: l.lineTotal + lineTax,
                productId: l.productId,
                serialNumberId: l.serialNumberId,
              }
            }),
          },
        },
        include: { items: true, client: true },
      })

      // Mark unapplied down payments as consumed by this final invoice.
      if (mode === 'final' && downDeduction > 0) {
        try {
          await tx.invoice.updateMany({
            where: {
              saleOrderId: orderId,
              isDownPayment: true,
              downPaymentAppliedToId: null,
              status: { notIn: ['cancelled'] as any },
            },
            data: { downPaymentAppliedToId: invoice.id },
          })
        } catch {
          /* column may be absent until migration — deduction still on this invoice */
        }
      }

      return invoice
    })

    const clientLines = mapDbInvoiceItemsToClientLines(result.items)
    const date = new Date().toISOString().slice(0, 10)
    const clientInvoice = {
      id: result.id,
      ref: result.invoiceNumber,
      type: 'customer_invoice' as const,
      status: 'draft' as const,
      partnerId: confirmed.clientId,
      partnerName: confirmed.client?.name ?? '',
      date,
      dueDate: dueDate.toISOString().slice(0, 10),
      lines: clientLines,
      subtotal,
      taxTotal: taxAmount,
      discountAmount,
      total: totalAmount,
      amountPaid: 0,
      saleOrderId: confirmed.id,
      notes: invoiceNotes,
      downPaymentDeduction: downDeduction > 0 ? downDeduction : undefined,
    }

    // Mirror into client store invoices for UI
    try {
      const invoices = [...blobInvoices]
      invoices.unshift(clientInvoice)
      // Best-effort: stamp applied downs in the blob mirror too.
      if (mode === 'final' && downDeduction > 0) {
        for (const inv of invoices) {
          if (inv && inv.saleOrderId === orderId && (inv.isDownPayment || /\[Down Payment/i.test(String(inv.notes ?? ''))) && !inv.downPaymentAppliedToId) {
            inv.downPaymentAppliedToId = result.id
            inv.notes = `${String(inv.notes ?? '')}\n[Down payment applied on ${result.invoiceNumber}]`.trim()
          }
        }
      }
      await saveStoreKeys({ deed_invoices: JSON.stringify(invoices) })
    } catch {
      // Prisma invoice is authoritative; store mirror best-effort
    }

    // Broadcast updated SO lines (qtyInvoiced)
    try {
      const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
      // Reuse broadcast shape from sale-orders route via store key
      await saveStoreKeys({
        deed_saleOrders: JSON.stringify(all.map(o => ({
          ...o,
          ref: o.orderNumber,
          customerId: o.clientId,
          customerName: o.client?.name ?? '',
          status: normalizeSaleStatus(o.status),
          total: Number(o.totalAmount ?? 0),
          lines: (o.items ?? []).map(item => ({
            id: item.id,
            productId: item.productId ?? '',
            productName: item.description ?? '',
            qty: Number(item.qty ?? 0),
            qtyDelivered: Number(item.qtyDelivered ?? 0),
            qtyInvoiced: Number(item.qtyInvoiced ?? 0),
            unitPrice: Number(item.unitPrice ?? 0),
            taxRate: Number(item.taxRate ?? 0),
            subtotal: Number(item.lineTotal ?? 0),
          })),
        }))),
      })
    } catch {}

    await writeFinancialAudit({
      userId: actor.id,
      action: 'create_invoice_from_so',
      entityType: 'invoice',
      entityId: result.id,
      newValues: { saleOrderId: orderId, ref: result.invoiceNumber, total: totalAmount },
    })

    return NextResponse.json({
      ok: true,
      invoice: clientInvoice,
    })
  })
}
