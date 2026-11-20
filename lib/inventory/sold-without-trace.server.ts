import 'server-only'

import { randomUUID } from 'crypto'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { bumpPrismaOnHand } from '@/lib/inventory/stock-transactions'
import { findSoldWithoutTrace, type SoldWithoutTrace } from './sold-without-trace'

const TRACE_KEYS = [
  'deed_serials', 'deed_saleOrders', 'deed_deliveries', 'deed_invoices', 'deed_posOrders',
  'deed_kilimallOrders', 'deed_kilimallDispatches', 'deed_warranties', 'deed_stockMoves',
] as const

const list = (v: unknown) => (Array.isArray(v) ? v : []) as Array<Record<string, any>>

export async function loadSoldWithoutTrace(): Promise<SoldWithoutTrace[]> {
  const state = await loadAppState([...TRACE_KEYS])
  return findSoldWithoutTrace({
    serials: list(state.deed_serials),
    saleOrders: list(state.deed_saleOrders),
    deliveries: list(state.deed_deliveries),
    invoices: list(state.deed_invoices),
    posOrders: list(state.deed_posOrders),
    kilimallOrders: list(state.deed_kilimallOrders),
    kilimallDispatches: list(state.deed_kilimallDispatches),
    warranties: list(state.deed_warranties),
    stockMoves: list(state.deed_stockMoves),
  })
}

/**
 * Put units marked sold with no sale behind them back into stock. Each one
 * is checked again here (the caller holds the serials lock): a unit that a
 * sale document now names is refused, not moved.
 *
 * Stock only: a unit with no sale never had its cost booked as a cost of
 * sale, so its value is still in inventory and no journal is posted.
 */
export async function returnSoldWithoutTrace(params: {
  serialIds: string[]
  reason: string
  location: string
  userId: string
  reference: string
}): Promise<{ returned: SoldWithoutTrace[]; refused: Array<{ id: string; why: string }> }> {
  const candidates = new Map((await loadSoldWithoutTrace()).map(u => [u.id, u]))
  const state = await loadAppState(['deed_products', 'deed_serials', 'deed_stockMoves'])
  const products = list(state.deed_products).map(p => ({ ...p }))
  const serials = list(state.deed_serials).map(s => ({ ...s }))
  const stockMoves = list(state.deed_stockMoves)

  const returned: SoldWithoutTrace[] = []
  const refused: Array<{ id: string; why: string }> = []
  const moves: Array<Record<string, unknown>> = []
  const onHand = new Map<string, number>()
  const now = new Date().toISOString()

  for (const id of [...new Set(params.serialIds)]) {
    const unit = candidates.get(id)
    const idx = serials.findIndex(s => s.id === id)
    if (idx < 0) { refused.push({ id, why: 'Unit not found' }); continue }
    if (!unit) {
      refused.push({
        id,
        why: serials[idx].status === 'sold'
          ? 'A sale names this unit — return it through After-Sales instead'
          : `It is ${String(serials[idx].status).replace(/_/g, ' ')}, not sold`,
      })
      continue
    }
    const s = serials[idx]
    serials[idx] = {
      ...s,
      status: 'available',
      location: params.location,
      soldDate: undefined,
      // Kept for the record: the order the unit was wrongly tied to, if any.
      ...(s.saleOrderId ? { previousSaleOrderId: s.saleOrderId } : {}),
      saleOrderId: undefined,
    }
    onHand.set(unit.productId, (onHand.get(unit.productId) ?? 0) + 1)
    moves.push({
      id: randomUUID(),
      type: 'in',
      productId: unit.productId,
      productName: unit.productName || products.find(p => p.id === unit.productId)?.name || 'Device',
      qty: 1,
      reason: `Marked sold with no sale record — back to stock: ${params.reason}`,
      fromLocation: 'customer',
      toLocation: params.location,
      serialNumbers: [unit.serial],
      date: now,
      userId: params.userId,
      documentRef: params.reference,
    })
    returned.push(unit)
  }

  if (returned.length) {
    for (const [productId, n] of onHand) {
      const p = products.findIndex(x => x.id === productId)
      if (p >= 0) products[p] = { ...products[p], stockQty: Number(products[p].stockQty ?? 0) + n }
    }
    await bumpPrismaOnHand(onHand)
    await saveStoreKeys({
      deed_products: JSON.stringify(products),
      deed_serials: JSON.stringify(serials),
      deed_stockMoves: JSON.stringify([...moves, ...stockMoves]),
    })
  }
  return { returned, refused }
}
