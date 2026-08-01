import 'server-only'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'
import { calcStockByLocation, upsertBulkStock } from '@/lib/business-logic'
import type { BulkStockLevel } from '@/lib/business-logic'
import type { LocationId } from '@/lib/store'
import { mirrorStockReservationsToPrisma } from '@/lib/inventory/reservation-mirror'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const VALID_LOCATIONS: LocationId[] = ['warehouse', 'shop', 'repair_unit', 'vendor', 'customer', 'employee']

function asLocationId(value: string | undefined): LocationId {
  const loc = String(value || 'warehouse')
  return (VALID_LOCATIONS.includes(loc as LocationId) ? loc : 'warehouse') as LocationId
}

type BlobProduct = {
  id: string
  name?: string
  stockQty?: number
  requiresSerial?: boolean
  unit?: string
  warrantyMonths?: number
}

type BlobSerial = {
  id: string
  serial?: string
  productId: string
  status: string
  location?: string
  saleOrderId?: string
  soldDate?: string
}

type BlobReservation = {
  id: string
  productId: string
  productName?: string
  qty: number
  reservedFor?: string
  referenceId?: string
  referenceRef?: string
  deliveryId?: string
  location?: string
  status: string
  fulfilledQty?: number
  fulfilledDate?: string
  serialNumbers?: string[]
}

type BlobStockMove = {
  id: string
  type: 'in' | 'out' | 'transfer' | 'adjustment' | 'return'
  productId: string
  productName: string
  qty: number
  reason: string
  fromLocation?: string
  toLocation?: string
  serialNumbers: string[]
  date: string
  userId: string
  documentRef: string
}

function isUuid(id: string | undefined): boolean {
  return Boolean(id && UUID_RE.test(id))
}

function nowIso() {
  return new Date().toISOString().slice(0, 10)
}

function reservedQtyForOthers(
  reservations: BlobReservation[],
  productId: string,
  location: string,
  saleOrderId: string,
): number {
  return reservations
    .filter(r =>
      r.productId === productId &&
      (r.location ?? 'warehouse') === location &&
      r.status === 'reserved' &&
      r.referenceId !== saleOrderId &&
      (r.reservedFor === 'sales_order' || r.reservedFor === 'sale_order' || !r.reservedFor),
    )
    .reduce((sum, r) => sum + Math.max(0, Number(r.qty) - Number(r.fulfilledQty ?? 0)), 0)
}

export async function applyDeliveryStockMutation(params: {
  deliveryId: string
  deliveryRef: string
  saleOrderId: string
  lines: Array<{ productId: string; productName: string; qty: number; serialIds?: string[]; sourceLocation?: string }>
  userId?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const state = await loadAppState([
    'deed_products',
    'deed_serials',
    'deed_bulkStock',
    'deed_stockMoves',
    'deed_stockReservations',
  ])

  const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
  const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
  let bulkStock: BulkStockLevel[] =
    Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
  const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []
  const stockReservations: BlobReservation[] =
    Array.isArray(state.deed_stockReservations) ? [...(state.deed_stockReservations as BlobReservation[])] : []

  const stockLevelDeltas = new Map<string, number>()
  const reservedReleaseByProduct = new Map<string, number>()
  const newMoves: BlobStockMove[] = []

  for (const line of params.lines) {
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue

    const product = products.find(p => p.id === line.productId)
    if (!product || product.unit === 'service') continue

    const location = asLocationId(line.sourceLocation)

    if (product.requiresSerial) {
      const serialIds = Array.isArray(line.serialIds) ? line.serialIds : []
      if (serialIds.length !== qty) {
        return { ok: false, error: `${line.productName}: ${qty} serial number(s) required` }
      }
      for (const serialId of serialIds) {
        const serial = serials.find(s => s.id === serialId)
        const validStatus =
          serial &&
          serial.productId === line.productId &&
          (serial.status === 'available' ||
            serial.status === 'in_stock' ||
            (serial.status === 'assigned' && serial.saleOrderId === params.saleOrderId))
        if (!validStatus) {
          return { ok: false, error: `${line.productName}: serial ${serial?.serial ?? serialId} is not available for delivery` }
        }
      }
    } else {
      const stockAtLocation = calcStockByLocation(
        { requiresSerial: false },
        [],
        bulkStock,
        line.productId,
      )[location] ?? 0
      const reservedElsewhere = reservedQtyForOthers(stockReservations, line.productId, location, params.saleOrderId)
      const available = Math.max(0, stockAtLocation - reservedElsewhere)
      if (available < qty) {
        return {
          ok: false,
          error: `Insufficient stock for ${line.productName}: need ${qty}, available ${available} at ${location}`,
        }
      }
      const onHand = Math.max(0, Number(product.stockQty) || 0)
      const reservedForOrder = stockReservations
        .filter(r =>
          r.productId === line.productId &&
          r.status === 'reserved' &&
          r.referenceId === params.saleOrderId,
        )
        .reduce((sum, r) => sum + Math.max(0, Number(r.qty) - Number(r.fulfilledQty ?? 0)), 0)
      const unreservedAvailable = Math.max(0, onHand - reservedQtyForOthers(stockReservations, line.productId, location, params.saleOrderId) - reservedForOrder)
      if (onHand < qty && unreservedAvailable + reservedForOrder < qty) {
        return {
          ok: false,
          error: `Insufficient on-hand stock for ${line.productName}: need ${qty}, on hand ${onHand}`,
        }
      }
    }
  }

  for (const line of params.lines) {
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue

    const productIdx = products.findIndex(p => p.id === line.productId)
    if (productIdx === -1) continue
    const product = products[productIdx]
    if (product.unit === 'service') continue

    const location = asLocationId(line.sourceLocation)
    const serialLabels: string[] = []

    if (product.requiresSerial) {
      for (const serialId of line.serialIds ?? []) {
        const serialIdx = serials.findIndex(s => s.id === serialId)
        if (serialIdx === -1) continue
        serialLabels.push(serials[serialIdx].serial ?? serialId)
        serials[serialIdx] = {
          ...serials[serialIdx],
          status: 'sold',
          location: 'customer',
          soldDate: nowIso(),
          saleOrderId: params.saleOrderId,
        }
      }
    } else {
      bulkStock = upsertBulkStock(bulkStock, line.productId, location, -qty)
    }

    products[productIdx] = {
      ...product,
      stockQty: Math.max(0, (Number(product.stockQty) || 0) - qty),
    }

    if (isUuid(line.productId)) {
      stockLevelDeltas.set(line.productId, (stockLevelDeltas.get(line.productId) ?? 0) - qty)
    }

    for (let rIdx = 0; rIdx < stockReservations.length; rIdx++) {
      const reservation = stockReservations[rIdx]
      if (
        reservation.productId !== line.productId ||
        reservation.status !== 'reserved' ||
        (reservation.referenceId !== params.saleOrderId &&
          reservation.deliveryId !== params.deliveryId)
      ) continue
      const prevFulfilled = Number(reservation.fulfilledQty ?? 0)
      const fulfilledQty = Math.min(Number(reservation.qty), prevFulfilled + qty)
      const released = fulfilledQty - prevFulfilled
      stockReservations[rIdx] = {
        ...reservation,
        fulfilledQty,
        status: fulfilledQty >= Number(reservation.qty) ? 'fulfilled' : 'reserved',
        fulfilledDate: fulfilledQty >= Number(reservation.qty) ? nowIso() : reservation.fulfilledDate,
      }
      if (released > 0 && isUuid(line.productId)) {
        reservedReleaseByProduct.set(
          line.productId,
          (reservedReleaseByProduct.get(line.productId) ?? 0) + released,
        )
      }
    }

    newMoves.push({
      id: randomUUID(),
      type: 'out',
      productId: line.productId,
      productName: line.productName || product.name || 'Item',
      qty,
      reason: `Delivery ${params.deliveryRef}`,
      fromLocation: location,
      toLocation: 'customer',
      serialNumbers: serialLabels,
      date: nowIso(),
      userId: params.userId ?? 'system',
      documentRef: params.deliveryRef,
    })
  }

  try {
    await prisma.$transaction(async tx => {
      for (const [productId, delta] of stockLevelDeltas) {
        const reservedDelta = -(reservedReleaseByProduct.get(productId) ?? 0)
        const existing = await tx.stockLevel.findUnique({ where: { productId } })
        if (existing) {
          await tx.stockLevel.update({
            where: { productId },
            data: {
              qtyOnHand: Math.max(0, existing.qtyOnHand + delta),
              qtyReserved: Math.max(0, existing.qtyReserved + reservedDelta),
            },
          })
        } else if (delta < 0 || reservedDelta < 0) {
          await tx.stockLevel.create({
            data: {
              id: uuidFromKey('stock_level', productId),
              productId,
              qtyOnHand: 0,
              qtyReserved: 0,
            },
          }).catch(() => {})
        }
      }
    })
  } catch (err) {
    console.error('[applyDeliveryStockMutation] prisma transaction failed:', err)
  }

  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_serials: JSON.stringify(serials),
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_stockMoves: JSON.stringify([...newMoves, ...stockMoves]),
    deed_stockReservations: JSON.stringify(stockReservations),
  })

  return { ok: true }
}

export async function reserveStockForSaleOrder(
  orderId: string,
  userId?: string,
): Promise<{ ok: true; reserved: number; skipped?: boolean } | { ok: false; error: string }> {
  const existingPrisma = await prisma.stockReservation.findMany({
    where: { saleOrderId: orderId, status: 'reserved' },
    select: { id: true },
  }).catch(() => [])
  if (existingPrisma.length > 0) {
    return { ok: true, reserved: 0, skipped: true }
  }

  const state = await loadAppState(['deed_stockReservations', 'deed_products', 'deed_saleOrders'])
  const reservations: BlobReservation[] =
    Array.isArray(state.deed_stockReservations) ? [...(state.deed_stockReservations as BlobReservation[])] : []
  if (reservations.some(r => r.referenceId === orderId && r.status === 'reserved')) {
    return { ok: true, reserved: 0, skipped: true }
  }

  const products: BlobProduct[] = Array.isArray(state.deed_products) ? (state.deed_products as BlobProduct[]) : []
  const saleOrders: any[] = Array.isArray(state.deed_saleOrders) ? state.deed_saleOrders : []
  const blobSo = saleOrders.find(so => so?.id === orderId)

  let orderLines: any[] = Array.isArray(blobSo?.lines) ? blobSo.lines : []
  let orderRef = String(blobSo?.ref ?? blobSo?.orderNumber ?? orderId)

  if (orderLines.length === 0) {
    const prismaSo = await prisma.saleOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    }).catch(() => null)
    if (!prismaSo) return { ok: false, error: 'Sale order not found' }
    orderRef = prismaSo.orderNumber
    orderLines = (prismaSo.items ?? []).map(item => ({
      productId: item.productId ?? '',
      productName: item.description ?? '',
      qty: Number(item.qty ?? 0),
      serialIds: item.serialNumberId ? [item.serialNumberId] : [],
    }))
  }

  const reservedDeltas = new Map<string, number>()
  let reservedCount = 0
  const reservedAt = new Date().toISOString()

  for (const line of orderLines) {
    if (line.lineType === 'section') continue
    const productId = String(line.productId ?? '')
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (!productId || qty <= 0) continue

    const product = products.find(p => p.id === productId)
    if (!product || product.unit === 'service') continue

    const reservationId = randomUUID()
    reservations.push({
      id: reservationId,
      productId,
      productName: String(line.productName ?? product.name ?? 'Item'),
      qty,
      reservedFor: 'sales_order',
      referenceId: orderId,
      referenceRef: orderRef,
      location: 'warehouse',
      status: 'reserved',
      fulfilledQty: 0,
      serialNumbers: Array.isArray(line.serialIds) ? line.serialIds : [],
    })
    reservedCount += qty
    if (isUuid(productId)) {
      reservedDeltas.set(productId, (reservedDeltas.get(productId) ?? 0) + qty)
    }
  }

  if (reservedCount === 0) {
    return { ok: true, reserved: 0 }
  }

  await saveStoreKeys({
    deed_stockReservations: JSON.stringify(reservations),
  })

  try {
    await mirrorStockReservationsToPrisma(reservations)
    await prisma.$transaction(async tx => {
      for (const [productId, delta] of reservedDeltas) {
        const existing = await tx.stockLevel.findUnique({ where: { productId } })
        if (existing) {
          await tx.stockLevel.update({
            where: { productId },
            data: { qtyReserved: existing.qtyReserved + delta },
          })
        } else {
          await tx.stockLevel.create({
            data: {
              id: uuidFromKey('stock_level', productId),
              productId,
              qtyOnHand: 0,
              qtyReserved: delta,
            },
          }).catch(() => {})
        }
      }
    })
  } catch (err) {
    console.error('[reserveStockForSaleOrder] prisma mirror failed:', err)
  }

  void userId
  return { ok: true, reserved: reservedCount }
}

async function bumpPrismaOnHand(deltas: Map<string, number>) {
  if (deltas.size === 0) return
  try {
    await prisma.$transaction(async tx => {
      for (const [productId, delta] of deltas) {
        if (!isUuid(productId)) continue
        const existing = await tx.stockLevel.findUnique({ where: { productId } })
        if (existing) {
          await tx.stockLevel.update({
            where: { productId },
            data: { qtyOnHand: Math.max(0, existing.qtyOnHand + delta) },
          })
        } else if (delta !== 0) {
          await tx.stockLevel.create({
            data: {
              id: uuidFromKey('stock_level', productId),
              productId,
              qtyOnHand: Math.max(0, delta),
              qtyReserved: 0,
            },
          }).catch(() => {})
        }
      }
    })
  } catch (err) {
    console.error('[stock-transactions] prisma stockLevel bump failed:', err)
  }
}

/** Authoritative POS sale stock out. */
export async function applyPosStockMutation(params: {
  orderRef: string
  lines: Array<{
    productId: string
    productName: string
    qty: number
    serialId?: string
    serialNumber?: string
    sourceLocation?: string
  }>
  userId?: string
}): Promise<{ ok: true; moves: BlobStockMove[] } | { ok: false; error: string }> {
  const state = await loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
  const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
  const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
  let bulkStock: BulkStockLevel[] =
    Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
  const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []
  const newMoves: BlobStockMove[] = []
  const stockLevelDeltas = new Map<string, number>()

  for (const line of params.lines) {
    const productId = String(line.productId || '')
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (!productId || qty <= 0) continue
    const product = products.find(p => p.id === productId)
    const location = asLocationId(line.sourceLocation || 'shop')

    if (line.serialId || product?.requiresSerial) {
      const serial = line.serialId
        ? serials.find(s => s.id === line.serialId)
        : serials.find(s =>
            s.productId === productId
            && String(s.serial || '').toLowerCase() === String(line.serialNumber || '').toLowerCase()
            && s.status === 'available',
          )
      if (!serial || serial.status !== 'available') {
        return { ok: false, error: `Serial not available for ${line.productName || productId}` }
      }
      serial.status = 'sold'
      serial.location = 'customer'
      serial.soldDate = nowIso()
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) - 1) }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) - 1)
      newMoves.push({
        id: randomUUID(), type: 'out', productId, productName: line.productName || product?.name || 'Item',
        qty: 1, reason: `POS ${params.orderRef}`, fromLocation: location, toLocation: 'customer',
        serialNumbers: [String(serial.serial || line.serialNumber || '')].filter(Boolean),
        date: nowIso(), userId: params.userId ?? 'system', documentRef: params.orderRef,
      })
    } else {
      const locs = calcStockByLocation(
        { requiresSerial: false },
        serials as any,
        bulkStock,
        productId,
      )
      const available = Number(locs[location] ?? 0)
      if (available < qty) {
        return { ok: false, error: `Insufficient stock for ${line.productName || productId} at ${location}` }
      }
      bulkStock = upsertBulkStock(bulkStock, productId, location, -qty)
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) - qty) }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) - qty)
      newMoves.push({
        id: randomUUID(), type: 'out', productId, productName: line.productName || product?.name || 'Item',
        qty, reason: `POS ${params.orderRef}`, fromLocation: location, toLocation: 'customer',
        serialNumbers: [], date: nowIso(), userId: params.userId ?? 'system', documentRef: params.orderRef,
      })
    }
  }

  await bumpPrismaOnHand(stockLevelDeltas)
  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_serials: JSON.stringify(serials),
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_stockMoves: JSON.stringify([...newMoves, ...stockMoves]),
  })
  return { ok: true, moves: newMoves }
}

/** Authoritative GRN stock in (after serial validation). */
export async function applyReceiptStockMutation(params: {
  receiptId: string
  receiptRef: string
  purchaseOrderId?: string
  destination: string
  lines: Array<{
    productId: string
    productName: string
    qtyReceived: number
    requiresSerial: boolean
    serials?: string[]
    serialRecords?: Array<Record<string, unknown>>
  }>
  userId?: string
}): Promise<{ ok: true; moves: BlobStockMove[] } | { ok: false; error: string }> {
  const state = await loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
  const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
  const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
  let bulkStock: BulkStockLevel[] =
    Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
  const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []
  const newMoves: BlobStockMove[] = []
  const stockLevelDeltas = new Map<string, number>()
  const destination = asLocationId(params.destination || 'warehouse')
  const existingSerialKeys = new Set(serials.map(s => String(s.serial || '').toLowerCase()).filter(Boolean))

  for (const line of params.lines) {
    const productId = String(line.productId || '')
    const qty = Math.max(0, Math.floor(Number(line.qtyReceived) || 0))
    if (!productId || qty <= 0) continue
    const productName = line.productName || products.find(p => p.id === productId)?.name || 'Item'

    if (line.requiresSerial) {
      const tokens = Array.isArray(line.serials) ? line.serials.map(s => String(s).trim()).filter(Boolean) : []
      if (tokens.length < qty) {
        return { ok: false, error: `Enter all serial numbers for ${productName}` }
      }
      for (const token of tokens.slice(0, qty)) {
        if (existingSerialKeys.has(token.toLowerCase())) {
          return { ok: false, error: `Serial ${token} already exists` }
        }
        existingSerialKeys.add(token.toLowerCase())
        const record = (line.serialRecords || []).find(r => String(r.serial || '').toLowerCase() === token.toLowerCase())
        serials.push({
          ...(record || {}),
          id: String(record?.id || randomUUID()),
          serial: token,
          productId,
          status: String(record?.status || 'available'),
          location: String(record?.location || destination),
        } as BlobSerial)
      }
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) products[idx] = { ...products[idx], stockQty: Number(products[idx].stockQty ?? 0) + qty }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) + qty)
      newMoves.push({
        id: randomUUID(), type: 'in', productId, productName, qty,
        reason: `Receipt ${params.receiptRef}`, fromLocation: 'vendor', toLocation: destination,
        serialNumbers: tokens.slice(0, qty), date: nowIso(),
        userId: params.userId ?? 'system', documentRef: params.receiptRef,
      })
    } else {
      bulkStock = upsertBulkStock(bulkStock, productId, destination, qty)
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) products[idx] = { ...products[idx], stockQty: Number(products[idx].stockQty ?? 0) + qty }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) + qty)
      newMoves.push({
        id: randomUUID(), type: 'in', productId, productName, qty,
        reason: `Receipt ${params.receiptRef}`, fromLocation: 'vendor', toLocation: destination,
        serialNumbers: [], date: nowIso(),
        userId: params.userId ?? 'system', documentRef: params.receiptRef,
      })
    }
  }

  await bumpPrismaOnHand(stockLevelDeltas)
  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_serials: JSON.stringify(serials),
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_stockMoves: JSON.stringify([...newMoves, ...stockMoves]),
  })
  void params.receiptId
  void params.purchaseOrderId
  return { ok: true, moves: newMoves }
}

/** Authoritative internal transfer. */
export async function applyTransferStockMutation(params: {
  transferRef: string
  fromLocation: string
  toLocation: string
  lines: Array<{ productId: string; productName: string; qty: number; serialIds?: string[] }>
  userId?: string
}): Promise<{ ok: true; moves: BlobStockMove[] } | { ok: false; error: string }> {
  const from = asLocationId(params.fromLocation)
  const to = asLocationId(params.toLocation)
  if (from === to) return { ok: false, error: 'Source and destination must differ' }

  const state = await loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
  const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
  const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
  let bulkStock: BulkStockLevel[] =
    Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
  const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []
  const newMoves: BlobStockMove[] = []

  for (const line of params.lines) {
    const productId = String(line.productId || '')
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (!productId || qty <= 0) continue
    const product = products.find(p => p.id === productId)
    const serialIds = Array.isArray(line.serialIds) ? line.serialIds : []

    if (product?.requiresSerial || serialIds.length > 0) {
      if (serialIds.length !== qty) {
        return { ok: false, error: `Select ${qty} serial(s) for ${line.productName}` }
      }
      const labels: string[] = []
      for (const sid of serialIds) {
        const serial = serials.find(s => s.id === sid)
        if (!serial || serial.status !== 'available' || asLocationId(serial.location) !== from) {
          return { ok: false, error: `Serial not available at ${from} for ${line.productName}` }
        }
        serial.location = to
        labels.push(String(serial.serial || ''))
      }
      newMoves.push({
        id: randomUUID(), type: 'transfer', productId, productName: line.productName,
        qty, reason: `Transfer ${params.transferRef}`, fromLocation: from, toLocation: to,
        serialNumbers: labels.filter(Boolean), date: nowIso(),
        userId: params.userId ?? 'system', documentRef: params.transferRef,
      })
    } else {
      const locs = calcStockByLocation({ requiresSerial: false }, serials as any, bulkStock, productId)
      if (Number(locs[from] ?? 0) < qty) {
        return { ok: false, error: `Insufficient stock for ${line.productName} at ${from}` }
      }
      bulkStock = upsertBulkStock(bulkStock, productId, from, -qty)
      bulkStock = upsertBulkStock(bulkStock, productId, to, qty)
      newMoves.push({
        id: randomUUID(), type: 'transfer', productId, productName: line.productName,
        qty, reason: `Transfer ${params.transferRef}`, fromLocation: from, toLocation: to,
        serialNumbers: [], date: nowIso(),
        userId: params.userId ?? 'system', documentRef: params.transferRef,
      })
    }
  }

  await saveStoreKeys({
    deed_serials: JSON.stringify(serials),
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_stockMoves: JSON.stringify([...newMoves, ...stockMoves]),
  })
  return { ok: true, moves: newMoves }
}

/** Authoritative stock adjustment (add/subtract at a location). */
export async function applyAdjustmentStockMutation(params: {
  adjustmentRef: string
  productId: string
  productName: string
  type: 'add' | 'subtract'
  qty: number
  reason: string
  location?: string
  userId?: string
}): Promise<{ ok: true; moves: BlobStockMove[] } | { ok: false; error: string }> {
  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  if (!params.productId || qty <= 0) return { ok: false, error: 'productId and qty required' }
  const location = asLocationId(params.location || 'warehouse')
  const delta = params.type === 'add' ? qty : -qty

  const state = await loadAppState(['deed_products', 'deed_bulkStock', 'deed_stockMoves'])
  const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
  let bulkStock: BulkStockLevel[] =
    Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
  const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []

  if (params.type === 'subtract') {
    const locs = calcStockByLocation({ requiresSerial: false }, [], bulkStock, params.productId)
    if (Number(locs[location] ?? 0) < qty) {
      return { ok: false, error: `Insufficient stock to adjust ${params.productName}` }
    }
  }

  bulkStock = upsertBulkStock(bulkStock, params.productId, location, delta)
  const idx = products.findIndex(p => p.id === params.productId)
  if (idx >= 0) {
    products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) + delta) }
  }

  const move: BlobStockMove = {
    id: randomUUID(),
    type: params.type === 'add' ? 'in' : 'adjustment',
    productId: params.productId,
    productName: params.productName,
    qty,
    reason: `Adj ${params.adjustmentRef}: ${params.reason}`,
    fromLocation: params.type === 'subtract' ? location : undefined,
    toLocation: params.type === 'add' ? location : undefined,
    serialNumbers: [],
    date: nowIso(),
    userId: params.userId ?? 'system',
    documentRef: params.adjustmentRef,
  }

  await bumpPrismaOnHand(new Map([[params.productId, delta]]))
  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_stockMoves: JSON.stringify([move, ...stockMoves]),
  })
  return { ok: true, moves: [move] }
}
