import 'server-only'

import { randomUUID } from 'crypto'
import { bumpPrismaOnHand } from '@/lib/inventory/stock-transactions'
import { postAdjustmentValuation } from '@/lib/inventory/valuation-hooks'
import { formatAccountLabel } from '@/lib/product-accounts'
import { loadAppStateForWrite, saveStoreKeys } from '@/lib/server-store'
import { unitMoveBlocker } from './unit-product-move'

/**
 * One machine changes product: the count moves (−1 / +1, on screen and in
 * the database), a stock move records it, and — after the records are saved —
 * its cost moves with it. Shared by Identify (refurbishment) and "Move to
 * another product" (inventory).
 */
type Product = { id: string; name?: string; stockQty?: number }
type Move = Record<string, unknown>

/** Inventory adjustment: the cost out of one product and into the other net to zero here. */
const ADJUSTMENT = () => formatAccountLabel('6305', [])
const money = (n: number) => Math.round(n * 100) / 100

export async function moveUnitCount(params: {
  products: Product[]
  moves: Move[]
  fromProductId: string
  to: Product
  serial: string
  location?: string
  reason: string
  documentRef: string
  userId: string
}) {
  for (const [pid, d] of [[params.fromProductId, -1], [params.to.id, 1]] as const) {
    const i = params.products.findIndex(p => p.id === pid)
    if (i >= 0) params.products[i] = { ...params.products[i], stockQty: Math.max(0, Number(params.products[i].stockQty ?? 0) + d) }
  }
  params.moves.unshift({
    id: randomUUID(), date: new Date().toISOString(),
    type: 'transfer', productId: params.to.id, productName: params.to.name, qty: 1, reason: params.reason,
    fromLocation: params.location, toLocation: params.location, serialNumbers: [params.serial],
    userId: params.userId, documentRef: params.documentRef,
  })
  await bumpPrismaOnHand(new Map([[params.fromProductId, -1], [params.to.id, 1]]))
}

/** The machine's cost leaves the old product and joins the new one at the same value. Returns that cost. */
export async function moveUnitCost(params: { fromProductId: string; toProductId: string; ref: string; text: string; userId: string }): Promise<number> {
  const out = await postAdjustmentValuation({
    adjustmentRef: `${params.ref} OUT ${Date.now()}`, productId: params.fromProductId, type: 'subtract', qty: 1, userId: params.userId,
    expenseAccountLabel: ADJUSTMENT(), expenseLineText: params.text,
  }).catch(() => null) as { result?: { totalCost?: number } } | null
  const cost = money(Number(out?.result?.totalCost) || 0)
  if (cost > 0) {
    await postAdjustmentValuation({
      adjustmentRef: `${params.ref} IN ${Date.now()}`, productId: params.toProductId, type: 'add', qty: 1, unitCost: cost, userId: params.userId,
      reversesWriteOff: true, expenseAccountLabel: ADJUSTMENT(), expenseLineText: params.text,
    }).catch(() => null)
  }
  return cost
}

type SerialRow = Record<string, any> & { id: string; serial: string; productId: string; status: string; location?: string }
type CatalogProduct = Product & { sku?: string; requiresSerial?: boolean; trackingMethod?: string }

/**
 * "Move to another product": a machine filed under the wrong model or specs
 * goes to the right product, with its count and cost. Its own record (serial,
 * asset ID, notes, history) moves unchanged; its specs text can be corrected.
 */
export async function moveSerialToProduct(params: {
  userId: string
  serialId: string
  productId: string
  reason: string
  specs?: string
}): Promise<{ ok: true; serial: SerialRow; fromProductName: string; cost: number } | { ok: false; error: string; status: number }> {
  const reason = params.reason.trim()
  if (reason.length < 3) return { ok: false, error: 'Say why it is moving (e.g. received under the wrong specs)', status: 422 }
  const state = await loadAppStateForWrite(['deed_products', 'deed_serials', 'deed_stockMoves'])
  const products = [...((state.deed_products as CatalogProduct[]) ?? [])]
  const serials = [...((state.deed_serials as SerialRow[]) ?? [])]
  const moves = [...((state.deed_stockMoves as Move[]) ?? [])]

  const unit = serials.find(s => s.id === params.serialId)
  if (!unit) return { ok: false, error: 'Machine not found', status: 404 }
  const blocked = unitMoveBlocker(unit)
  if (blocked) return { ok: false, error: `${unit.serial}: ${blocked}`, status: 409 }
  const target = products.find(p => p.id === params.productId)
  if (!target) return { ok: false, error: 'Choose the product it belongs to', status: 422 }
  if (target.id === unit.productId) return { ok: false, error: `${unit.serial} is already under ${target.name}`, status: 409 }
  if (!(target.requiresSerial || target.trackingMethod === 'SERIAL')) return { ok: false, error: `${target.name} does not track serial numbers`, status: 422 }

  const fromProductName = String(unit.productName || products.find(p => p.id === unit.productId)?.name || 'the old product')
  const moved: SerialRow = {
    ...unit,
    productId: target.id,
    productName: target.name || unit.productName,
    sku: target.sku,
    ...(params.specs?.trim() ? { specs: params.specs.trim().slice(0, 500) } : {}),
  }
  const text = `Corrected: ${unit.serial} moved from ${fromProductName} to ${target.name} — ${reason}`
  await moveUnitCount({ products, moves, fromProductId: unit.productId, to: target, serial: unit.serial, location: unit.location, reason: text, documentRef: unit.serial, userId: params.userId })
  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_serials: JSON.stringify(serials.map(s => (s.id === unit.id ? moved : s))),
    deed_stockMoves: JSON.stringify(moves),
  })
  const cost = await moveUnitCost({ fromProductId: unit.productId, toProductId: target.id, ref: `${unit.serial} MOVE`, text, userId: params.userId })
  return { ok: true, serial: moved, fromProductName, cost }
}
