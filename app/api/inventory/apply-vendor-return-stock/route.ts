import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { applyVendorReturnStockMutation } from '@/lib/inventory/stock-transactions'
import { postVendorReturnValuation } from '@/lib/inventory/valuation-hooks'
import prisma from '@/lib/prisma'
import { notifyStoreKeysChanged } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

const ROLES = new Set(['director', 'admin_officer', 'inventory_officer'])

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ROLES.has(String(session.user.role))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    returnRef?: string
    reason?: string
    lines?: Array<{
      productId: string
      productName: string
      qty: number
      serialIds?: string[]
      requiresSerial?: boolean
    }>
    /** The returned goods' purchase order and its lines' counts after the return. */
    po?: { id?: string; lines?: Array<{ poLineId?: string; qtyReceived?: number; qtyBilled?: number }> }
  } | null

  if (!body?.returnRef || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: 'returnRef and lines required' }, { status: 400 })
  }

  const result = await applyVendorReturnStockMutation({
    returnRef: body.returnRef,
    lines: body.lines,
    reason: body.reason,
    userId: session.user.id,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  const valuation = await postVendorReturnValuation({
    returnRef: body.returnRef,
    lines: body.lines,
    userId: session.user.id,
  }).catch(err => ({ ok: false as const, reason: err instanceof Error ? err.message : 'valuation_failed', results: [], warnings: [] }))

  const po = await windBackPurchaseOrder(body.po).catch(err => {
    console.error('[vendor-return] purchase order counts not updated:', err)
    return null
  })

  return NextResponse.json({ ok: true, moves: result.moves, valuation, po })
}

/**
 * Lower the purchase order's received / billed counts for the returned goods
 * (the deed_purchaseOrders screen copy is frozen, so the order's lines in the
 * table are what the screens show). Counts only ever go down here, and a fully
 * received order reopens as partial so the vendor can re-supply.
 */
async function windBackPurchaseOrder(po: { id?: string; lines?: Array<{ poLineId?: string; qtyReceived?: number; qtyBilled?: number }> } | undefined) {
  const poId = String(po?.id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(poId) || !Array.isArray(po?.lines) || !po!.lines.length) return null
  const order = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } })
  if (!order) return null
  const count = (v: unknown, current: number) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) ? Math.max(0, Math.min(current, n)) : current
  }
  let changed = false
  for (const adj of po!.lines) {
    const item = order.items.find(i => i.id === adj.poLineId)
    if (!item) continue
    const qtyReceived = count(adj.qtyReceived, item.qtyReceived)
    const qtyBilled = count(adj.qtyBilled, item.qtyBilled)
    if (qtyReceived === item.qtyReceived && qtyBilled === item.qtyBilled) continue
    await prisma.purchaseOrderItem.update({ where: { id: item.id }, data: { qtyReceived, qtyBilled } })
    item.qtyReceived = qtyReceived
    changed = true
  }
  if (!changed) return null
  if (order.status === 'received' && order.items.some(i => i.qtyReceived < i.qtyOrdered)) {
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'partial' } })
  }
  await notifyStoreKeysChanged(['deed_purchaseOrders'])
  return { id: poId }
}
