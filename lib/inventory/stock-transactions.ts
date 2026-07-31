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
