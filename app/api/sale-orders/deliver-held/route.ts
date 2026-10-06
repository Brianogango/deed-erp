/**
 * Deliver a sale order's held units (lib/sales/deliver-held.ts).
 *
 * GET  ?so=SO/2026/0004 — preview: per line, the held serials that would go
 *      out, and those left alone (held for another order, in refurbishment…).
 * POST { so }           — attach those serials to the order and validate one
 *      delivery through the normal stock path: serials sold, stock moved,
 *      cost of sales booked, order lines marked delivered. Director only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { requireRole, withApiErrorHandling } from '@/lib/auth/api'
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { applyDeliveryStockMutation } from '@/lib/inventory/stock-transactions'
import { postDeliveryValuationFromPayload } from '@/lib/inventory/valuation-hooks'
import { mirrorDeliveryToPrisma } from '@/lib/delivery-mirror'
import { getNextDocNumber } from '@/lib/doc-ref-counter'
import { appendInventoryAuditLog } from '@/lib/inventory/audit'
import { mapSaleOrderToClient } from '@/lib/sales/sale-order-client-shape'
import { planHeldDelivery } from '@/lib/sales/deliver-held'

export const dynamic = 'force-dynamic'

const ROLES = ['director']
type Row = Record<string, any>
const asRows = (v: unknown) => (Array.isArray(v) ? v as Row[] : [])

async function plan(soRef: string) {
  const state = await loadAppState(['deed_saleOrders', 'deed_serials', 'deed_deliveries'])
  const saleOrders = asRows(state.deed_saleOrders)
  const so = saleOrders.find(o => String(o.ref || o.orderNumber) === soRef || o.id === soRef)
  if (!so) throw Object.assign(new Error(`Sale order ${soRef} not found`), { status: 404 })
  const lines = planHeldDelivery({ saleOrder: so, serials: asRows(state.deed_serials), deliveries: asRows(state.deed_deliveries), saleOrders })
  return { so, lines }
}

export async function GET(request: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireRole(ROLES)
    const soRef = String(request.nextUrl.searchParams.get('so') ?? '').trim()
    if (!soRef) return NextResponse.json({ error: 'so is required' }, { status: 400 })
    const { so, lines } = await plan(soRef)
    return NextResponse.json({ saleOrder: { id: so.id, ref: so.ref, customerName: so.customerName, status: so.status }, lines })
  })
}

export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const actor = await requireRole(ROLES)
    const body = await request.json().catch(() => ({})) as { so?: string }
    const soRef = String(body.so ?? '').trim()
    if (!soRef) return NextResponse.json({ error: 'so is required' }, { status: 400 })
    const { so, lines } = await plan(soRef)
    const picks = lines.flatMap(l => l.pick.map(p => ({ ...p, productName: l.productName })))
    if (!picks.length) return NextResponse.json({ error: 'No held units to deliver for this order' }, { status: 409 })

    // 1. The held units belong to this order from now on.
    const pickIds = new Set(picks.map(p => p.id))
    await withAppStateKeyLock('deed_serials', async () => {
      const state = await loadAppStateForWrite(['deed_serials'])
      const serials = asRows(state.deed_serials).map(s => (pickIds.has(String(s.id)) && s.status === 'assigned' && (!s.saleOrderId || s.saleOrderId === so.id)
        ? { ...s, saleOrderId: so.id }
        : s))
      await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
    })

    // 2. One delivery, validated through the normal stock path.
    const byProduct = new Map<string, { productId: string; productName: string; serialIds: string[] }>()
    for (const p of picks) {
      const line = byProduct.get(p.productId) ?? { productId: p.productId, productName: p.productName, serialIds: [] }
      line.serialIds.push(p.id)
      byProduct.set(p.productId, line)
    }
    const deliveryLines = [...byProduct.values()].map(l => ({
      productId: l.productId,
      productName: l.productName,
      qty: l.serialIds.length,
      qtyDone: l.serialIds.length,
      serialIds: l.serialIds,
      sourceLocation: 'warehouse',
    }))
    const id = randomUUID()
    const ref = await getNextDocNumber('delivery_note')
    const outcome = await withAppStateKeyLock('deed_deliveries', async () => {
      const stock = await applyDeliveryStockMutation({ deliveryId: id, deliveryRef: ref, saleOrderId: String(so.id), lines: deliveryLines, userId: actor.id })
      if (!stock.ok) return { ok: false as const, error: stock.error }
      const valuation = await postDeliveryValuationFromPayload({ deliveryRef: ref, lines: deliveryLines, userId: actor.id })
        .catch(err => ({ ok: false, reason: err instanceof Error ? err.message : 'valuation failed' }))
      const state = await loadAppStateForWrite(['deed_deliveries'])
      const delivery = {
        id, ref,
        saleOrderId: so.id, saleOrderRef: so.ref || so.orderNumber,
        customerId: so.customerId || so.clientId || '', customerName: so.customerName || '',
        status: 'done', date: new Date().toISOString(), lines: deliveryLines,
        warrantyCreated: false,
        notes: `Delivered from held stock by ${actor.name || actor.username}`,
      }
      await saveStoreKeys({ deed_deliveries: JSON.stringify([delivery, ...asRows(state.deed_deliveries)]) })
      return { ok: true as const, delivery, valuation }
    })
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 409 })
    void mirrorDeliveryToPrisma(outcome.delivery).catch(() => {})

    // 3. Order lines: delivered quantities.
    try {
      const order = await prisma.saleOrder.findUnique({ where: { id: String(so.id) }, include: { items: true } })
      if (order) {
        for (const line of deliveryLines) {
          const item = order.items.find(i => i.productId === line.productId)
            ?? order.items.find(i => String(i.description ?? '').toLowerCase().startsWith(line.productName.toLowerCase()))
          if (!item) continue
          const next = Math.min(Number(item.qty) || 0, (Number(item.qtyDelivered) || 0) + line.qty)
          await prisma.saleOrderItem.update({ where: { id: item.id }, data: { qtyDelivered: next } })
        }
        const all = await prisma.saleOrder.findMany({ include: { client: true, items: true }, orderBy: { createdAt: 'desc' } })
        await saveStoreKeys({ deed_saleOrders: JSON.stringify(all.map(mapSaleOrderToClient)) })
      }
    } catch (err) {
      console.error('[deliver-held] order lines not updated:', err)
    }

    await appendInventoryAuditLog({
      action: 'deliver_held_units',
      documentRef: ref,
      details: `${picks.length} held unit(s) delivered for ${so.ref} (${so.customerName}): ${picks.map(p => p.serial).join(', ')}`,
      userId: actor.id,
      username: actor.username || actor.name,
    })
    return NextResponse.json({ deliveryRef: ref, delivered: picks.length, serials: picks.map(p => p.serial), valuation: outcome.valuation })
  })
}
