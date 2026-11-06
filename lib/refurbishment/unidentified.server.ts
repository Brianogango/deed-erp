import 'server-only'

import { randomUUID } from 'crypto'
import { loadAppStateForWrite, saveStoreKeys } from '@/lib/server-store'
import { upsertBulkStock, type BulkStockLevel } from '@/lib/business-logic'
import { applySerialWriteOffMutation, bumpPrismaOnHand } from '@/lib/inventory/stock-transactions'
import { postAdjustmentValuation } from '@/lib/inventory/valuation-hooks'
import { formatAccountLabel } from '@/lib/product-accounts'
import { awaitingIdentification, classifySerialMatch, harvestValues, isIntakeTag, nextIntakeTags, splitUnitCosts } from './unidentified'

type Product = { id: string; name?: string; sku?: string; stockQty?: number; requiresSerial?: boolean; trackingMethod?: string }
type Serial = Record<string, any> & { id: string; serial: string; productId: string; status: string; location?: string }
type Move = Record<string, unknown>
type Fail = { ok: false; error: string; status: number }

/** Inventory adjustment: a move of cost between products nets to zero here. */
const ADJUSTMENT = () => formatAccountLabel('6305', [])

const isSerialized = (p: Product) => Boolean(p.requiresSerial || p.trackingMethod === 'SERIAL')
const now = () => new Date().toISOString()
const money = (n: number) => Math.round(n * 100) / 100

function move(m: Omit<Move, 'id' | 'date'>): Move {
  return { id: randomUUID(), date: now(), ...m }
}

async function valuationCost(result: unknown): Promise<number> {
  const r = result as { ok?: boolean; result?: { totalCost?: number } } | null
  return money(Number(r?.result?.totalCost) || 0)
}

/**
 * Machines into Refurbishment with a tag instead of a serial.
 * `from`: they were counted as quantity stock on another product (no serials);
 * that stock comes off and its cost moves onto the tagged units. Without
 * `from` they were never on record; any cost given is added as stock value.
 */
export async function intakeTaggedUnits(params: {
  userId: string
  userName?: string
  productId: string
  units: Array<{ cost?: number | null; note?: string }>
  from?: { productId: string; location: string }
  reference: string
}): Promise<{ ok: true; serials: Serial[]; costs: number[]; sourceCost: number } | Fail> {
  const n = params.units.length
  if (n < 1 || n > 50) return { ok: false, error: 'Add between 1 and 50 machines at a time', status: 422 }
  const state = await loadAppStateForWrite(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
  const products = [...((state.deed_products as Product[]) ?? [])]
  let serials = [...((state.deed_serials as Serial[]) ?? [])]
  let bulk = [...((state.deed_bulkStock as BulkStockLevel[]) ?? [])]
  const moves = [...((state.deed_stockMoves as Move[]) ?? [])]

  const target = products.find(p => p.id === params.productId)
  if (!target) return { ok: false, error: 'Choose the product to file the machines under', status: 422 }
  if (!isSerialized(target)) return { ok: false, error: `${target.name} does not track serial numbers — choose a serial-tracked product (e.g. "Laptop — unidentified")`, status: 422 }

  let source: Product | undefined
  if (params.from) {
    source = products.find(p => p.id === params.from!.productId)
    if (!source) return { ok: false, error: 'The stock product was not found', status: 422 }
    if (isSerialized(source)) return { ok: false, error: `${source.name} has serial numbers — send those units from their serials instead`, status: 422 }
    const available = bulk.filter(b => b.productId === source!.id && b.location === params.from!.location).reduce((s, b) => s + Math.max(0, Number(b.qty) || 0), 0)
    if (available < n) return { ok: false, error: `Only ${available} of ${source.name} at that location`, status: 409 }
  }

  // Cost leaves the source first, so the tagged units can carry it.
  let sourceCost = 0
  if (source) {
    const v = await postAdjustmentValuation({
      adjustmentRef: `${params.reference} OUT ${Date.now()}`, productId: source.id, type: 'subtract', qty: n, userId: params.userId,
      expenseAccountLabel: ADJUSTMENT(), expenseLineText: `Sent to refurbishment as tagged units · ${params.reference}`,
    }).catch(() => null)
    sourceCost = await valuationCost(v)
  }
  const costs = splitUnitCosts(sourceCost, params.units.map(u => (u.cost == null || u.cost === ('' as unknown) ? null : Number(u.cost))))

  const tags = nextIntakeTags(serials, n)
  const created: Serial[] = tags.map((tag, i) => ({
    id: randomUUID(),
    serial: tag,
    intakeTag: tag,
    identityPending: true,
    productId: target.id,
    productName: target.name || 'Machine',
    sku: target.sku,
    location: 'repair_unit',
    status: 'refurbishment',
    receivedDate: now(),
    barcode: tag,
    specs: '',
    intakeSource: 'refurb-intake',
    intakeByName: params.userName,
    intakeCost: costs[i],
    ...(params.units[i].note ? { accessoryNotes: String(params.units[i].note).slice(0, 300) } : {}),
  }))
  serials = [...serials, ...created]

  const deltas = new Map<string, number>([[target.id, n]])
  const ti = products.findIndex(p => p.id === target.id)
  products[ti] = { ...products[ti], stockQty: Math.max(0, Number(products[ti].stockQty ?? 0) + n) }
  if (source) {
    bulk = upsertBulkStock(bulk, source.id, params.from!.location as never, -n)
    const si = products.findIndex(p => p.id === source!.id)
    products[si] = { ...products[si], stockQty: Math.max(0, Number(products[si].stockQty ?? 0) - n) }
    deltas.set(source.id, -n)
    moves.unshift(move({ type: 'out', productId: source.id, productName: source.name, qty: n, reason: `To refurbishment as ${tags[0]}${n > 1 ? `…${tags[n - 1]}` : ''}`, fromLocation: params.from!.location, toLocation: 'repair_unit', serialNumbers: [], userId: params.userId, documentRef: params.reference }))
  }
  moves.unshift(move({ type: 'in', productId: target.id, productName: target.name, qty: n, reason: source ? `Tagged from ${source.name} stock` : 'Machines without serial taken in for refurbishment', fromLocation: source ? params.from!.location : undefined, toLocation: 'repair_unit', serialNumbers: tags, userId: params.userId, documentRef: params.reference }))

  await bumpPrismaOnHand(deltas)
  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_serials: JSON.stringify(serials),
    deed_bulkStock: JSON.stringify(bulk),
    deed_stockMoves: JSON.stringify(moves),
  })

  for (const [i, s] of created.entries()) {
    if (!(costs[i] > 0)) continue
    await postAdjustmentValuation({
      adjustmentRef: `${params.reference} ${s.serial}`, productId: target.id, type: 'add', qty: 1, unitCost: costs[i], userId: params.userId,
      ...(source ? { reversesWriteOff: true, expenseAccountLabel: ADJUSTMENT(), expenseLineText: `Tagged unit ${s.serial}` } : {}),
    }).catch(() => null)
  }
  return { ok: true, serials: created, costs, sourceCost }
}

/**
 * The technician found the real serial (and model). The tag stays on the
 * unit as its barcode, so the sticker still scans. A serial we had before
 * (sold, written off) means the machine came back: its old record is taken
 * over. A different product moves the unit's stock and cost onto it.
 */
export async function identifyTaggedUnit(params: {
  userId: string
  serialId: string
  serial: string
  productId?: string
  specs?: string
}): Promise<{ ok: true; serial: Serial; removedSerialId?: string; history?: { saleOrderId?: string; soldDate?: string; status: string } } | Fail> {
  const real = params.serial.trim()
  if (real.length < 3) return { ok: false, error: 'Enter the serial number from the machine', status: 422 }
  if (isIntakeTag(real)) return { ok: false, error: 'That is the intake tag — enter the serial from the machine (sticker or BIOS)', status: 422 }
  const state = await loadAppStateForWrite(['deed_products', 'deed_serials', 'deed_stockMoves'])
  const products = [...((state.deed_products as Product[]) ?? [])]
  let serials = [...((state.deed_serials as Serial[]) ?? [])]
  const moves = [...((state.deed_stockMoves as Move[]) ?? [])]

  const unit = serials.find(s => s.id === params.serialId)
  if (!unit) return { ok: false, error: 'Unit not found', status: 404 }
  if (!awaitingIdentification(unit)) return { ok: false, error: `${unit.serial} is already identified`, status: 409 }
  const target = products.find(p => p.id === (params.productId || unit.productId))
  if (!target) return { ok: false, error: 'Choose the product', status: 422 }
  if (!isSerialized(target)) return { ok: false, error: `${target.name} does not track serial numbers`, status: 422 }

  const match = classifySerialMatch(serials, real, unit.id)
  if (match.kind === 'in_stock') {
    return { ok: false, error: `${real} is already in stock (${match.match.status} at ${match.match.location}). Check the serial — one machine cannot be in two places.`, status: 409 }
  }

  const tag = unit.intakeTag || unit.serial
  const identified = {
    productId: target.id,
    productName: target.name || unit.productName,
    sku: target.sku,
    location: unit.location || 'repair_unit',
    status: unit.status === 'written_off' ? unit.status : 'refurbishment',
    identityPending: false,
    intakeTag: tag,
    barcode: unit.barcode || tag,
    intakeCost: unit.intakeCost,
    identifiedDate: now(),
    ...(params.specs?.trim() ? { specs: params.specs.trim().slice(0, 500) } : {}),
  }
  let result: Serial
  let history: { saleOrderId?: string; soldDate?: string; status: string } | undefined
  if (match.kind === 'returning') {
    const old = match.match as Serial
    history = { saleOrderId: old.saleOrderId, soldDate: old.soldDate, status: old.status }
    result = {
      ...old,
      ...identified,
      previousSaleOrderId: old.saleOrderId,
      saleOrderId: undefined,
      soldDate: undefined,
      accessoryNotes: [old.accessoryNotes, unit.accessoryNotes].filter(Boolean).join(' · ') || undefined,
    }
    serials = serials.filter(s => s.id !== unit.id).map(s => (s.id === old.id ? result : s))
  } else {
    result = { ...unit, ...identified, serial: real }
    serials = serials.map(s => (s.id === unit.id ? result : s))
  }

  const moved = target.id !== unit.productId
  if (moved) {
    for (const [pid, d] of [[unit.productId, -1], [target.id, 1]] as const) {
      const i = products.findIndex(p => p.id === pid)
      if (i >= 0) products[i] = { ...products[i], stockQty: Math.max(0, Number(products[i].stockQty ?? 0) + d) }
    }
    moves.unshift(move({ type: 'transfer', productId: target.id, productName: target.name, qty: 1, reason: `Identified: tag ${tag} is ${real} (was filed under ${unit.productName})`, fromLocation: result.location, toLocation: result.location, serialNumbers: [real], userId: params.userId, documentRef: tag }))
    await bumpPrismaOnHand(new Map([[unit.productId, -1], [target.id, 1]]))
  }
  await saveStoreKeys({
    ...(moved ? { deed_products: JSON.stringify(products), deed_stockMoves: JSON.stringify(moves) } : {}),
    deed_serials: JSON.stringify(serials),
  })

  if (moved && result.status !== 'written_off') {
    const out = await postAdjustmentValuation({
      adjustmentRef: `${tag} ID-OUT ${Date.now()}`, productId: unit.productId, type: 'subtract', qty: 1, userId: params.userId,
      expenseAccountLabel: ADJUSTMENT(), expenseLineText: `Identified ${tag} as ${real}`,
    }).catch(() => null)
    const cost = await valuationCost(out)
    if (cost > 0) {
      await postAdjustmentValuation({
        adjustmentRef: `${tag} ID-IN ${Date.now()}`, productId: target.id, type: 'add', qty: 1, unitCost: cost, userId: params.userId,
        reversesWriteOff: true, expenseAccountLabel: ADJUSTMENT(), expenseLineText: `Identified ${tag} as ${real}`,
      }).catch(() => null)
    }
  }
  return { ok: true, serial: result, ...(match.kind === 'returning' ? { removedSerialId: unit.id } : {}), ...(history ? { history } : {}) }
}

/**
 * A machine that cannot be repaired is stripped: it is written off, and the
 * parts kept go into stock carrying part of its cost. What the parts do not
 * carry stays a write-off.
 */
export async function harvestUnit(params: {
  userId: string
  serialId: string
  reference: string
  reason: string
  parts: Array<{ productId: string; qty: number; unitValue: number }>
  location?: string
}): Promise<{ ok: true; serial: string; machineCost: number; partsValue: number; parts: Array<{ productId: string; productName: string; qty: number; unitValue: number }>; valuationRef: string } | Fail> {
  if (!params.parts.length) return { ok: false, error: 'List the parts you kept', status: 422 }
  const pre = await loadAppStateForWrite(['deed_products'])
  const catalog = (pre.deed_products as Product[]) ?? []
  for (const p of params.parts) {
    const product = catalog.find(c => c.id === p.productId)
    if (!product) return { ok: false, error: 'A part product was not found', status: 422 }
    if (isSerialized(product)) return { ok: false, error: `${product.name} tracks serial numbers — add it from Inventory with its serial instead`, status: 422 }
    if (!(Number.isInteger(p.qty) && p.qty >= 1 && p.qty <= 100)) return { ok: false, error: `Enter a whole quantity for ${product.name}`, status: 422 }
  }

  const off = await applySerialWriteOffMutation({ serialId: params.serialId, reference: params.reference, reason: `Harvested for parts: ${params.reason}`, action: 'write_off', userId: params.userId })
  if (!off.ok) return { ok: false, error: off.error, status: off.status ?? 422 }
  const valuationRef = `${params.reference} HARVEST ${off.serial} ${Date.now()}`
  const v = await postAdjustmentValuation({ adjustmentRef: valuationRef, productId: off.productId, type: 'subtract', qty: 1, userId: params.userId, expenseLineText: `Harvested for parts · ${off.serial}` }).catch(() => null)
  const machineCost = await valuationCost(v)
  const values = harvestValues(machineCost, params.parts)

  const location = params.location || 'warehouse'
  const state = await loadAppStateForWrite(['deed_products', 'deed_bulkStock', 'deed_stockMoves'])
  const products = [...((state.deed_products as Product[]) ?? [])]
  let bulk = [...((state.deed_bulkStock as BulkStockLevel[]) ?? [])]
  const moves = [...((state.deed_stockMoves as Move[]) ?? [])]
  const deltas = new Map<string, number>()
  const parts = params.parts.map((p, i) => {
    const idx = products.findIndex(x => x.id === p.productId)
    products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) + p.qty) }
    bulk = upsertBulkStock(bulk, p.productId, location as never, p.qty)
    deltas.set(p.productId, (deltas.get(p.productId) ?? 0) + p.qty)
    moves.unshift(move({ type: 'in', productId: p.productId, productName: products[idx].name, qty: p.qty, reason: `Harvested from ${off.serial}`, fromLocation: 'repair_unit', toLocation: location, serialNumbers: [], userId: params.userId, documentRef: params.reference }))
    return { productId: p.productId, productName: products[idx].name || 'Part', qty: p.qty, unitValue: values[i] }
  })
  await bumpPrismaOnHand(deltas)
  await saveStoreKeys({ deed_products: JSON.stringify(products), deed_bulkStock: JSON.stringify(bulk), deed_stockMoves: JSON.stringify(moves) })

  for (const p of parts) {
    if (!(p.unitValue > 0)) continue
    await postAdjustmentValuation({
      adjustmentRef: `${valuationRef} ${p.productId}`, productId: p.productId, type: 'add', qty: p.qty, unitCost: p.unitValue, userId: params.userId,
      reversesWriteOff: true, expenseLineText: `Parts harvested from ${off.serial}`,
    }).catch(() => null)
  }
  const partsValue = money(parts.reduce((s, p) => s + p.qty * p.unitValue, 0))
  return { ok: true, serial: off.serial, machineCost, partsValue, parts, valuationRef }
}
