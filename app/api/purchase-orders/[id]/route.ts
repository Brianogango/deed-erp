import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid } from '@/lib/legacy-compat'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { WRITE_ROLES, mapPOToClient, mirrorPurchaseOrder, computePOTotals } from '@/lib/purchase/po-api-shared'
import { resolvePOLineProducts } from '@/lib/purchase/po-prisma-sync'

/** PO statuses that must never be removed from the record (audit FIN-003). */
const PROTECTED_PO_STATUSES = new Set(['partial', 'received'])

/**
 * Same shape as Sales' mapSaleOrderItems: a full-object PATCH always
 * deletes+recreates line items, so fulfilment progress (qtyReceived /
 * qtyBilled) must be preserved across the cycle by matching against the
 * existing rows — otherwise a stale client PATCH can wipe received/billed
 * counters back to 0.
 */
function mapPOItemsForUpdate(lines: any[], existingItems: any[]) {
  return lines
    .filter((l: any) => Boolean(optionalUuid(l.productId)))
    .map((l: any) => {
      const prev =
        (l.id ? existingItems.find((row: any) => row.id === l.id) : null) ??
        (l.productId ? existingItems.find((row: any) => row.productId === l.productId) : null)

      const rawQty = Number(l.qty)
      const rawUnitCost = Number(l.unitPrice)
      const rawTaxRate = Number(l.taxRate)
      const qtyOrdered = Number.isFinite(rawQty) ? Math.min(1_000_000, Math.max(0, Math.floor(rawQty))) : 0
      const unitCost = Number.isFinite(rawUnitCost) ? Math.min(9_999_999_999.99, Math.max(0, rawUnitCost)) : 0
      const taxRate = Number.isFinite(rawTaxRate) ? Math.min(100, Math.max(0, rawTaxRate)) : 0

      // Receiving and billing counters are controlled by GRN/bill workflows.
      // A stale or tampered PO edit can preserve progress but can never advance it.
      const qtyReceived = Math.min(qtyOrdered, Math.max(0, Number(prev?.qtyReceived) || 0))
      const qtyBilled = Math.min(qtyOrdered, Math.max(0, Number(prev?.qtyBilled) || 0))
      return {
        productId: optionalUuid(l.productId),
        description: l.productName ?? l.description
          ? String(l.productName ?? l.description).trim().slice(0, 1_000)
          : null,
        qtyOrdered,
        qtyReceived,
        qtyBilled,
        unitCost,
        taxRate,
        lineTotal: Math.round(qtyOrdered * unitCost * 100) / 100,
        accountCode: l.accountCode ? String(l.accountCode).trim().slice(0, 80) : null,
      }
    })
}

const CLIENT_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['draft', 'sent', 'confirmed', 'cancelled'],
  sent: ['sent', 'confirmed', 'cancelled'],
  confirmed: ['confirmed', 'cancelled'],
  partial: ['partial'],
  received: ['received'],
  cancelled: ['cancelled'],
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    await getRequiredSession()
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: params.id },
      include: { vendor: true, items: { include: { product: true } } },
    })
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(mapPOToClient(po))
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
    }
    const body = await request.json()

    const existing = await prisma.purchaseOrder.findUnique({
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

    const data: Record<string, any> = { lockVersion: nextLockVersion(existing.lockVersion) }

    if (body.ref !== undefined && String(body.ref) !== existing.poNumber) {
      return NextResponse.json({ error: 'Purchase order number is system-controlled' }, { status: 400 })
    }

    if (body.status !== undefined) {
      const requestedStatus = String(body.status)
      const allowed = CLIENT_STATUS_TRANSITIONS[String(existing.status)] ?? [String(existing.status)]
      if (!allowed.includes(requestedStatus)) {
        return NextResponse.json(
          { error: `Illegal purchase order status change: ${existing.status} → ${requestedStatus}` },
          { status: 409 },
        )
      }
      const hasProgress = existing.items.some((item: any) => Number(item.qtyReceived) > 0 || Number(item.qtyBilled) > 0)
      if (requestedStatus === 'cancelled' && hasProgress) {
        return NextResponse.json({ error: 'A received or billed purchase order cannot be cancelled from the edit form' }, { status: 409 })
      }
      data.status = requestedStatus
    }

    if (body.date !== undefined) {
      const parsed = new Date(String(body.date))
      if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: 'Invalid purchase order date' }, { status: 422 })
      data.orderDate = parsed
    }
    if (body.expectedDate !== undefined) {
      if (!body.expectedDate) data.expectedDate = null
      else {
        const parsed = new Date(String(body.expectedDate))
        if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: 'Invalid expected date' }, { status: 422 })
        data.expectedDate = parsed
      }
    }
    if (body.notes !== undefined) data.notes = body.notes == null ? null : String(body.notes).trim().slice(0, 5_000)

    if (Array.isArray(body.lines)) {
      // Same P2003 guard as PO create: resolve/auto-create missing products.
      const resolvedLines = await resolvePOLineProducts(mapPOItemsForUpdate(body.lines, existing.items))
      const safeLines = resolvedLines.filter(l => l.productId)
      const totals = computePOTotals(safeLines)
      data.items = { deleteMany: {}, create: safeLines }
      // Header money is always derived from the server-validated lines. Client
      // subtotal/tax/total fields are display hints only and are ignored.
      data.subtotal = totals.subtotal
      data.taxAmount = totals.taxAmount
      data.totalAmount = totals.totalAmount
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: params.id },
      data,
      include: { vendor: true, items: { include: { product: true } } },
    })

    const mirrored = await mirrorPurchaseOrder(updated, body)
    return NextResponse.json(mirrored)
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  return PATCH(request, { params })
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!WRITE_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
    }

    const existing = await prisma.purchaseOrder.findUnique({
      where: { id: params.id },
      include: { vendor: true, items: { include: { product: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (existing.status === 'cancelled') {
      return NextResponse.json({ ok: true, item: mapPOToClient(existing) })
    }

    const hasReceipts = existing.items.some(i => i.qtyReceived > 0)
    const hasBills = existing.items.some(i => i.qtyBilled > 0)
    if (PROTECTED_PO_STATUSES.has(existing.status) || hasReceipts || hasBills) {
      return NextResponse.json({ error: 'Received or billed purchase orders cannot be deleted' }, { status: 409 })
    }

    const cancelled = await prisma.purchaseOrder.update({
      where: { id: params.id },
      data: { status: 'cancelled', lockVersion: nextLockVersion(existing.lockVersion) },
      include: { vendor: true, items: { include: { product: true } } },
    })

    await writeFinancialAudit({
      userId: session.user.id,
      action: 'cancel_purchase_order',
      entityType: 'purchase_order',
      entityId: existing.id,
      oldValues: { status: existing.status, ref: existing.poNumber },
      newValues: { status: 'cancelled' },
    })

    const mirrored = await mirrorPurchaseOrder(cancelled, {})
    return NextResponse.json({ ok: true, item: mirrored })
  })
}
