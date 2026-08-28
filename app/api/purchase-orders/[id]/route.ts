import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { optionalUuid } from '@/lib/legacy-compat'
import { lockVersionMismatch, nextLockVersion, readExpectedVersion } from '@/lib/optimistic-lock'
import { writeFinancialAudit } from '@/lib/finance-audit'
import { WRITE_ROLES, mapPOToClient, mirrorPurchaseOrder } from '../route'
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
      const qtyOrdered = Math.max(0, Math.floor(Number(l.qty) || 0))
      const incomingReceived = Math.max(0, Math.floor(Number(l.qtyReceived) || 0))
      const incomingBilled = Math.max(0, Math.floor(Number(l.qtyBilled) || 0))
      const qtyReceived = Math.min(qtyOrdered, Math.max(Number(prev?.qtyReceived) || 0, incomingReceived))
      const qtyBilled = Math.min(qtyOrdered, Math.max(Number(prev?.qtyBilled) || 0, incomingBilled))
      return {
        productId: optionalUuid(l.productId),
        description: l.productName ?? l.description ?? null,
        qtyOrdered,
        qtyReceived,
        qtyBilled,
        unitCost: Math.max(0, Number(l.unitPrice) || 0),
        taxRate: Math.max(0, Number(l.taxRate) || 0),
        lineTotal: Math.max(0, Number(l.subtotal) || 0),
        accountCode: l.accountCode ?? null,
      }
    })
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
    if (body.ref !== undefined) data.poNumber = body.ref
    if (body.status !== undefined) data.status = body.status
    if (body.date !== undefined) data.orderDate = new Date(body.date)
    if (body.expectedDate !== undefined) data.expectedDate = body.expectedDate ? new Date(body.expectedDate) : null
    if (body.subtotal !== undefined) data.subtotal = Math.max(0, Number(body.subtotal) || 0)
    if (body.taxTotal !== undefined || body.taxAmount !== undefined) data.taxAmount = Math.max(0, Number(body.taxTotal ?? body.taxAmount) || 0)
    if (body.total !== undefined || body.totalAmount !== undefined) data.totalAmount = Math.max(0, Number(body.total ?? body.totalAmount) || 0)
    if (body.notes !== undefined) data.notes = body.notes ?? null

    if (Array.isArray(body.lines)) {
      // Same P2003 guard as PO create: resolve/auto-create missing products.
      const resolvedLines = await resolvePOLineProducts(mapPOItemsForUpdate(body.lines, existing.items))
      data.items = { deleteMany: {}, create: resolvedLines.filter(l => l.productId) }
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
