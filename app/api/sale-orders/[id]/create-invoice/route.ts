import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import {
  deliveredByProductFromDoneDeliveries,
  hasGeneratedDeliveryNote,
  invoiceableQty,
  normalizeSaleStatus,
} from '@/lib/odoo-sales-flow'
import { mapDbInvoiceItemsToClientLines } from '@/lib/finance-invoice'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

const WRITE_ROLES = ['director', 'finance_officer', 'admin_officer']

/**
 * Atomic SO → draft customer invoice.
 * Locks line qtyInvoiced on the Prisma sale order items in the same transaction.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(WRITE_ROLES)
    const orderId = params.id

    const order = await prisma.saleOrder.findUnique({
      where: { id: orderId },
      include: { client: true, items: true },
    })
    if (!order) return NextResponse.json({ error: 'Sale order not found' }, { status: 404 })

    const status = normalizeSaleStatus(order.status)
    if (status !== 'sale') {
      return NextResponse.json({ error: 'Only a confirmed Sales Order can be invoiced' }, { status: 409 })
    }

    const state = await loadAppState(['deed_invoices', 'deed_deliveries'])
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
    if (!hasGeneratedDeliveryNote(deliveries, orderId)) {
      return NextResponse.json({
        error: 'Validate the delivery and generate its Delivery Note before creating an invoice',
      }, { status: 409 })
    }

    // Heal qtyDelivered from Done delivery lines (qtyDone / serials) when a
    // legacy Done DN left Prisma delivered=0 — otherwise Create Invoice is blocked.
    const healedFromDeliveries = deliveredByProductFromDoneDeliveries(deliveries, orderId)
    const healedItems = await Promise.all((order.items ?? []).map(async item => {
      const productId = item.productId ?? ''
      const fromDelivery = productId ? (healedFromDeliveries[productId] ?? 0) : 0
      const fromSerial = item.serialNumberId ? 1 : 0
      const current = Number(item.qtyDelivered) || 0
      const demand = Number(item.qty) || 0
      const healed = Math.min(demand, Math.max(current, fromDelivery, fromSerial))
      if (healed > current) {
        await prisma.saleOrderItem.update({
          where: { id: item.id },
          data: { qtyDelivered: healed },
        })
        return { ...item, qtyDelivered: healed }
      }
      return item
    }))

    const invoiceable = healedItems.map(item => {
      const qty = invoiceableQty({
        qty: Number(item.qty) || 0,
        qtyDelivered: Number(item.qtyDelivered) || 0,
        qtyInvoiced: Number(item.qtyInvoiced) || 0,
        invoicePolicy: 'delivery',
      })
      return { item, qty }
    }).filter(entry => entry.qty > 0)

    if (invoiceable.length === 0) {
      return NextResponse.json({
        error: 'Nothing to invoice — quantities are already invoiced or not yet delivered',
      }, { status: 409 })
    }

    const lines = invoiceable.map(({ item, qty }) => {
      const unit = Number(item.unitPrice) || 0
      const taxRate = Number(item.taxRate) || 0
      const lineTotal = Math.round(unit * qty)
      return {
        description: `${item.description ?? 'Item'} ×${qty}`,
        qty,
        unitPrice: unit,
        taxRate,
        lineTotal,
        productId: item.productId ?? undefined,
      }
    })

    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0)
    const taxAmount = lines.reduce((s, l) => s + Math.round(l.lineTotal * (l.taxRate || 0) / 100), 0)
    const totalAmount = subtotal + taxAmount
    if (totalAmount < 1) {
      return NextResponse.json({ error: 'Invoice total must be at least KES 1' }, { status: 400 })
    }

    const draftRef = await getNextDocNumber('invoice').catch(() => `DRAFT-INV-${Date.now().toString().slice(-6)}`)

    const result = await prisma.$transaction(async (tx) => {
      // Re-read items inside the transaction to reduce race window
      const fresh = await tx.saleOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      })
      if (!fresh) throw new Error('Sale order disappeared')

      for (const { item, qty } of invoiceable) {
        const live = fresh.items.find(i => i.id === item.id)
        if (!live) throw new Error('Sale order line missing')
        const still = invoiceableQty({
          qty: Number(live.qty) || 0,
          qtyDelivered: Number(live.qtyDelivered) || 0,
          qtyInvoiced: Number(live.qtyInvoiced) || 0,
          invoicePolicy: 'delivery',
        })
        if (still < qty) throw new Error('Invoiceable quantity changed — retry')
        await tx.saleOrderItem.update({
          where: { id: live.id },
          data: { qtyInvoiced: Number(live.qtyInvoiced || 0) + qty },
        })
      }

      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: draftRef,
          status: 'draft',
          clientId: order.clientId,
          saleOrderId: order.id,
          invoiceDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 86400000),
          subtotal,
          taxAmount,
          totalAmount,
          amountPaid: 0,
          notes: `Created from ${order.orderNumber}`,
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
              }
            }),
          },
        },
        include: { items: true, client: true },
      })

      return invoice
    })

    const clientLines = mapDbInvoiceItemsToClientLines(result.items)
    const date = new Date().toISOString().slice(0, 10)
    const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const clientInvoice = {
      id: result.id,
      ref: result.invoiceNumber,
      type: 'customer_invoice' as const,
      status: 'draft' as const,
      partnerId: order.clientId,
      partnerName: order.client?.name ?? '',
      date,
      dueDate,
      lines: clientLines,
      subtotal,
      taxTotal: taxAmount,
      total: totalAmount,
      amountPaid: 0,
      saleOrderId: order.id,
      notes: `Created from ${order.orderNumber}`,
    }

    // Mirror into client store invoices for UI
    try {
      const invoices = Array.isArray(state.deed_invoices) ? [...(state.deed_invoices as unknown[])] : []
      invoices.unshift(clientInvoice)
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
