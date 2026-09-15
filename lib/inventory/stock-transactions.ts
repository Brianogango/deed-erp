import 'server-only'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { adjustStockLevel, createZeroStockLevel } from '@/lib/inventory/stock-level'
import { calcStockByLocation, upsertBulkStock } from '@/lib/business-logic'
import type { BulkStockLevel } from '@/lib/business-logic'
import type { LocationId } from '@/lib/store'
import { mirrorStockReservationsToPrisma } from '@/lib/inventory/reservation-mirror'
import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'
import { isOnHandSerialStatus } from '@/lib/inventory/serial-status'
import { seedSerialSpecs } from '@/lib/reconfiguration/unit-config'
import { isNonStockProduct } from '@/lib/sales/non-stock-line'
import { resolveVendorBillPoItem } from '@/lib/purchase/bill-po-line-match'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const VALID_LOCATIONS: LocationId[] = ['warehouse', 'shop', 'repair_unit', 'computer_aid', 'computer_aid_collected', 'computer_aid_issues', 'vendor', 'customer', 'employee']

function asLocationId(value: string | undefined): LocationId {
  const loc = String(value || 'warehouse')
  return (VALID_LOCATIONS.includes(loc as LocationId) ? loc : 'warehouse') as LocationId
}

type BlobProduct = {
  id: string
  name?: string
  sku?: string
  stockQty?: number
  requiresSerial?: boolean
  trackingMethod?: string
  category?: string
  unit?: string
  productKind?: string
  trackStock?: boolean
  warrantyMonths?: number
  costPrice?: number
  sellingPrice?: number
  specs?: unknown
  deviceConfig?: {
    totalRamGb: number
    primaryStorageGb?: number | null
    storageType?: string | null
  } | null
}

type BlobSerial = {
  id: string
  serial?: string
  productId: string
  status: string
  location?: string
  saleOrderId?: string
  soldDate?: string
  specs?: string
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

function isPrismaUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'P2002')
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
    if (!product || isNonStockProduct(product)) continue

    const location = asLocationId(line.sourceLocation)
    const serialTracked = isSerialTracking(inferTrackingMethod(product))

    if (serialTracked) {
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
        product,
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
    if (isNonStockProduct(product)) continue

    const location = asLocationId(line.sourceLocation)
    const serialLabels: string[] = []
    const serialTracked = isSerialTracking(inferTrackingMethod(product))

    if (serialTracked) {
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
        await adjustStockLevel(tx, productId, {
          onHand: delta,
          reserved: reservedDelta,
        })
      }
    })
  } catch (err) {
    console.error('[applyDeliveryStockMutation] prisma transaction failed:', err)
    throw err
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

/**
 * Reverse a just-applied delivery stock mutation when valuation fails.
 * Restores on-hand, serials, reservations, and Prisma stock levels.
 */
export async function reverseDeliveryStockMutation(params: {
  deliveryId: string
  deliveryRef: string
  saleOrderId: string
  lines: Array<{ productId: string; productName: string; qty: number; serialIds?: string[]; sourceLocation?: string }>
}): Promise<void> {
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
  const reservedRestoreByProduct = new Map<string, number>()

  for (const line of params.lines) {
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue
    const productIdx = products.findIndex(p => p.id === line.productId)
    if (productIdx === -1) continue
    const product = products[productIdx]
    if (isNonStockProduct(product)) continue
    const location = asLocationId(line.sourceLocation)
    const serialTracked = isSerialTracking(inferTrackingMethod(product))

    if (serialTracked) {
      for (const serialId of line.serialIds ?? []) {
        const serialIdx = serials.findIndex(s => s.id === serialId)
        if (serialIdx === -1) continue
        serials[serialIdx] = {
          ...serials[serialIdx],
          status: 'available',
          location,
          soldDate: undefined,
        }
      }
    } else {
      bulkStock = upsertBulkStock(bulkStock, line.productId, location, qty)
    }

    products[productIdx] = {
      ...product,
      stockQty: (Number(product.stockQty) || 0) + qty,
    }
    if (isUuid(line.productId)) {
      stockLevelDeltas.set(line.productId, (stockLevelDeltas.get(line.productId) ?? 0) + qty)
    }

    for (let rIdx = 0; rIdx < stockReservations.length; rIdx++) {
      const reservation = stockReservations[rIdx]
      if (
        reservation.productId !== line.productId ||
        (reservation.referenceId !== params.saleOrderId && reservation.deliveryId !== params.deliveryId)
      ) continue
      const prevFulfilled = Number(reservation.fulfilledQty ?? 0)
      const restored = Math.min(prevFulfilled, qty)
      const fulfilledQty = Math.max(0, prevFulfilled - restored)
      stockReservations[rIdx] = {
        ...reservation,
        fulfilledQty,
        status: 'reserved',
        fulfilledDate: fulfilledQty > 0 ? reservation.fulfilledDate : undefined,
      }
      if (restored > 0 && isUuid(line.productId)) {
        reservedRestoreByProduct.set(
          line.productId,
          (reservedRestoreByProduct.get(line.productId) ?? 0) + restored,
        )
      }
    }
  }

  const remainingMoves = stockMoves.filter(m => m.documentRef !== params.deliveryRef)

  try {
    await prisma.$transaction(async tx => {
      for (const [productId, delta] of stockLevelDeltas) {
        const reservedDelta = reservedRestoreByProduct.get(productId) ?? 0
        await adjustStockLevel(tx, productId, {
          onHand: delta,
          reserved: reservedDelta,
        })
      }
    })
  } catch (err) {
    console.error('[reverseDeliveryStockMutation] prisma transaction failed:', err)
    throw err
  }

  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_serials: JSON.stringify(serials),
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_stockMoves: JSON.stringify(remainingMoves),
    deed_stockReservations: JSON.stringify(stockReservations),
  })
}

export async function reversePosStockMutation(params: {
  orderRef: string
  lines: Array<{
    productId: string
    productName: string
    qty: number
    serialId?: string
    serialNumber?: string
    sourceLocation?: string
  }>
}): Promise<void> {
  const state = await loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
  const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
  const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
  let bulkStock: BulkStockLevel[] =
    Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
  const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []
  const stockLevelDeltas = new Map<string, number>()
  const location: LocationId = 'warehouse'

  for (const line of params.lines) {
    const productId = String(line.productId || '')
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (!productId || qty <= 0) continue
    const product = products.find(p => p.id === productId)

    if (line.serialId || (product && isSerialTracking(inferTrackingMethod(product)))) {
      const serial = line.serialId
        ? serials.find(s => s.id === line.serialId)
        : serials.find(s =>
            s.productId === productId
            && String(s.serial || '').toLowerCase() === String(line.serialNumber || '').toLowerCase(),
          )
      if (serial) {
        serial.status = 'available'
        serial.location = location
        serial.soldDate = undefined
      }
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) products[idx] = { ...products[idx], stockQty: Number(products[idx].stockQty ?? 0) + 1 }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) + 1)
    } else {
      bulkStock = upsertBulkStock(bulkStock, productId, location, qty)
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) products[idx] = { ...products[idx], stockQty: Number(products[idx].stockQty ?? 0) + qty }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) + qty)
    }
  }

  await bumpPrismaOnHand(stockLevelDeltas)
  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_serials: JSON.stringify(serials),
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_stockMoves: JSON.stringify(stockMoves.filter(m => m.documentRef !== params.orderRef)),
  })
}

export async function reverseReceiptStockMutation(params: {
  receiptRef: string
  destination: string
  lines: Array<{
    productId: string
    qtyReceived: number
    requiresSerial: boolean
    serials?: string[]
  }>
}): Promise<void> {
  const state = await loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
  const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
  let serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
  let bulkStock: BulkStockLevel[] =
    Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
  const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []
  const destination = asLocationId(params.destination || 'warehouse')
  const stockLevelDeltas = new Map<string, number>()
  const serialKeys = new Set(
    params.lines.flatMap(l => (l.serials || []).map(s => String(s).toLowerCase())).filter(Boolean),
  )

  for (const line of params.lines) {
    const productId = String(line.productId || '')
    const qty = Math.max(0, Math.floor(Number(line.qtyReceived) || 0))
    if (!productId || qty <= 0) continue
    const idx = products.findIndex(p => p.id === productId)
    if (idx >= 0) {
      products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) - qty) }
    }
    if (!line.requiresSerial) {
      bulkStock = upsertBulkStock(bulkStock, productId, destination, -qty)
    }
    stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) - qty)
  }

  if (serialKeys.size > 0) {
    serials = serials.filter(s => !serialKeys.has(String(s.serial || '').toLowerCase()))
  }

  await bumpPrismaOnHand(stockLevelDeltas)
  await rollbackRelationalReceipt(params.receiptRef)
  await saveStoreKeys({
    deed_products: JSON.stringify(products),
    deed_serials: JSON.stringify(serials),
    deed_bulkStock: JSON.stringify(bulkStock),
    deed_stockMoves: JSON.stringify(stockMoves.filter(m => m.documentRef !== params.receiptRef)),
  })
}

/**
 * Valuation rollback used to reverse blob + StockLevel but leave the
 * GoodsReceivedNote row. Retrying Validate then crashed on
 * goods_received_notes_grn_number_key. Undo the PO counters and delete the
 * GRN so a retry is a clean create.
 */
async function rollbackRelationalReceipt(receiptRef: string) {
  const ref = String(receiptRef || '').trim()
  if (!ref) return

  await prisma.$transaction(async tx => {
    const grn = await tx.goodsReceivedNote.findUnique({
      where: { grnNumber: ref },
      include: { items: true },
    })
    if (!grn) return

    const itemIds = grn.items.map(item => item.id)
    if (itemIds.length > 0) {
      await tx.serialNumber.updateMany({
        where: { purchaseItemId: { in: itemIds } },
        data: { purchaseItemId: null },
      })
      await tx.inventoryBatch.updateMany({
        where: { receivedLineId: { in: itemIds } },
        data: { receivedLineId: null },
      })
    }

    for (const item of grn.items) {
      const poItem = await tx.purchaseOrderItem.findUnique({
        where: { id: item.poItemId },
        select: { id: true, qtyReceived: true },
      })
      if (!poItem) continue
      await tx.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: { qtyReceived: Math.max(0, poItem.qtyReceived - item.qtyReceived) },
      })
    }

    await tx.goodsReceivedNote.delete({ where: { id: grn.id } })

    const refreshedItems = await tx.purchaseOrderItem.findMany({ where: { poId: grn.poId } })
    const allReceived = refreshedItems.length > 0
      && refreshedItems.every(item => item.qtyReceived >= item.qtyOrdered)
    const anyReceived = refreshedItems.some(item => item.qtyReceived > 0)
    const nextStatus = allReceived ? 'received' : anyReceived ? 'partial' : 'confirmed'
    if (anyReceived || nextStatus === 'confirmed') {
      await tx.purchaseOrder.update({
        where: { id: grn.poId },
        data: { status: nextStatus },
      })
    }
  })
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
    if (!product || isNonStockProduct(product)) continue

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
        await adjustStockLevel(tx, productId, { reserved: delta })
      }
    })
  } catch (err) {
    console.error('[reserveStockForSaleOrder] prisma mirror failed:', err)
    throw err
  }

  void userId
  return { ok: true, reserved: reservedCount }
}

const PRODUCT_NAME_MAX = 500

function skuFromStockHint(productId: string, hint?: { sku?: string; name?: string }) {
  const sku = String(hint?.sku || '').trim()
  if (sku) return sku.slice(0, 60)
  const seed = String(hint?.name || 'PRODUCT').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 24) || 'PRODUCT'
  return `${seed}-${productId.replace(/-/g, '').slice(0, 8)}`.slice(0, 60)
}

export async function resolvePrismaProductIdForStock(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  productId: string,
  hint?: { sku?: string; name?: string; requiresSerial?: boolean; trackingMethod?: string; costPrice?: number; sellingPrice?: number },
): Promise<string | null> {
  const byId = await tx.product.findUnique({ where: { id: productId }, select: { id: true } })
  if (byId) return byId.id

  const sku = String(hint?.sku || '').trim()
  if (sku) {
    const bySku = await tx.product.findFirst({
      where: { sku: { equals: sku, mode: 'insensitive' } },
      select: { id: true },
    })
    if (bySku) {
      console.warn(`[stock] mapped blob product ${productId} → prisma ${bySku.id} via SKU ${sku}`)
      return bySku.id
    }
  }

  const name = String(hint?.name || '').trim()
  if (name) {
    const byName = await tx.product.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (byName) {
      console.warn(`[stock] mapped blob product ${productId} → prisma ${byName.id} via name`)
      return byName.id
    }
  }

  if (!isUuid(productId) || !name) return null

  const tracking = String(hint?.trackingMethod || '').toUpperCase() === 'SERIAL' || hint?.requiresSerial
    ? 'SERIAL' as const
    : 'QUANTITY' as const
  try {
    const created = await tx.product.create({
      data: {
        id: productId,
        sku: skuFromStockHint(productId, hint),
        name: name.slice(0, PRODUCT_NAME_MAX),
        description: name.slice(0, 2000),
        trackingMethod: tracking,
        trackStock: true,
        costPrice: Number(hint?.costPrice || 0),
        sellingPrice: Number(hint?.sellingPrice || 0),
      },
    })
    await createZeroStockLevel(tx, created.id)
    console.warn(`[stock] created missing Prisma product ${created.id} (${created.sku}) from catalogue`)
    return created.id
  } catch (err) {
    console.error('[stock] failed to create missing Prisma product', productId, err)
    const again = await tx.product.findUnique({ where: { id: productId }, select: { id: true } })
    return again?.id ?? null
  }
}

async function bumpPrismaOnHand(deltas: Map<string, number>) {
  if (deltas.size === 0) return
  const state = await loadAppState(['deed_products'])
  const blobProducts = Array.isArray(state.deed_products)
    ? (state.deed_products as Array<{ id?: string; sku?: string; name?: string; sellingPrice?: number; costPrice?: number; trackingMethod?: string }>)
    : []
  const byBlobId = new Map(blobProducts.filter(p => p?.id).map(p => [String(p.id), p]))

  try {
    await prisma.$transaction(async tx => {
      for (const [productId, delta] of deltas) {
        if (!isUuid(productId) || delta === 0) continue
        const hint = byBlobId.get(productId)
        const resolved = await resolvePrismaProductIdForStock(tx, productId, {
          sku: hint?.sku,
          name: hint?.name,
          trackingMethod: hint?.trackingMethod,
          costPrice: hint?.costPrice,
          sellingPrice: hint?.sellingPrice,
        })
        if (!resolved) {
          throw new Error(
            `Cannot update stock for "${hint?.name || productId}" — this product is in the app catalogue but not linked in the database (ID mismatch). Re-save/publish the product from Inventory, then retry the GRN.`,
          )
        }
        await adjustStockLevel(tx, resolved, { onHand: delta })
      }
    })
  } catch (err) {
    console.error('[stock-transactions] prisma stockLevel bump failed:', err)
    throw err
  }
}

/**
 * Atomic relational side of a goods receipt: bumps StockLevel, advances
 * PurchaseOrderItem.qtyReceived (clamped, never past qtyOrdered), and writes
 * a GoodsReceivedNote/GrnItem audit trail — all inside one prisma.$transaction
 * so a partial failure (e.g. an unresolvable product) rolls the whole receipt
 * back instead of leaving stock bumped with no matching PO/GRN record.
 *
 * Deliberately does NOT touch PurchaseOrder.lockVersion: the caller
 * (validateReceipt in lib/store.tsx) immediately follows this with its own
 * client-driven PATCH to /api/purchase-orders/[id] carrying the lockVersion
 * it last fetched — bumping it here would make that PATCH 409 on every
 * single receipt. qtyReceived is a monotonic, additive counter that's safe
 * to advance out from under the optimistic lock.
 *
 * Create is idempotent on grnNumber (the blob receipt ref). A first attempt
 * that committed the GRN then failed later (valuation, blob lock, overlapping
 * Validate click) used to surface Prisma's goods_received_notes_grn_number_key
 * error on retry. Reuse the existing row and skip stock/qty mutations.
 */
async function applyReceiptRelational(params: {
  purchaseOrderId?: string
  receiptRef: string
  supplierInvoiceNo?: string
  notes?: string
  userId?: string
  lines: Array<{ productId: string; productName: string; qty: number; sku?: string; requiresSerial?: boolean; trackingMethod?: string; costPrice?: number; sellingPrice?: number }>
}): Promise<{ grnItemsByProductId: Map<string, string>; resolvedProductIds: Map<string, string> }> {
  const grnItemsByProductId = new Map<string, string>()
  const resolvedProductIds = new Map<string, string>()
  const validLines = params.lines.filter(l => l.qty > 0)
  if (validLines.length === 0) return { grnItemsByProductId, resolvedProductIds }

  let purchaseOrderId = params.purchaseOrderId
  if (purchaseOrderId && isUuid(purchaseOrderId) && params.userId) {
    try {
      const { ensurePrismaPurchaseOrder } = await import('@/lib/purchase/po-prisma-sync')
      const resolved = await ensurePrismaPurchaseOrder(purchaseOrderId, params.userId)
      if (resolved) purchaseOrderId = resolved
    } catch {
      // Materialize is best-effort; findUnique below still runs.
    }
  }

  await prisma.$transaction(async tx => {
    const po =
      purchaseOrderId && isUuid(purchaseOrderId)
        ? await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, include: { items: true } })
        : null

    const adoptExistingGrn = async (existing: { id: string; poId: string; items: Array<{ id: string; productId: string }> }) => {
      if (po && existing.poId !== po.id) {
        throw new Error(
          `Receipt ${params.receiptRef} was already posted against a different purchase order.`,
        )
      }
      for (const line of validLines) {
        const resolved = await resolvePrismaProductIdForStock(tx, line.productId, {
          name: line.productName,
          sku: line.sku,
          requiresSerial: line.requiresSerial,
          trackingMethod: line.trackingMethod,
          costPrice: line.costPrice,
          sellingPrice: line.sellingPrice,
        })
        if (!resolved) continue
        resolvedProductIds.set(line.productId, resolved)
        const existingItem = existing.items.find(item => item.productId === resolved)
        if (existingItem) grnItemsByProductId.set(line.productId, existingItem.id)
      }
    }

    let grnId: string | null = null
    if (po && params.userId) {
      const prior = await tx.goodsReceivedNote.findUnique({
        where: { grnNumber: params.receiptRef },
        include: { items: true },
      })
      if (prior) {
        await adoptExistingGrn(prior)
        return
      }
      try {
        grnId = (
          await tx.goodsReceivedNote.create({
            data: {
              grnNumber: params.receiptRef,
              poId: po.id,
              supplierInvoiceNo: params.supplierInvoiceNo || null,
              notes: params.notes || null,
              createdById: params.userId,
            },
          })
        ).id
      } catch (err) {
        if (!isPrismaUniqueViolation(err)) throw err
        const raced = await tx.goodsReceivedNote.findUnique({
          where: { grnNumber: params.receiptRef },
          include: { items: true },
        })
        if (!raced) throw err
        await adoptExistingGrn(raced)
        return
      }
    }

    for (const line of validLines) {
      const resolved = await resolvePrismaProductIdForStock(tx, line.productId, {
        name: line.productName,
        sku: line.sku,
        requiresSerial: line.requiresSerial,
        trackingMethod: line.trackingMethod,
        costPrice: line.costPrice,
        sellingPrice: line.sellingPrice,
      })
      if (!resolved) {
        throw new Error(
          `Cannot update stock for "${line.productName || line.productId}" — this product is in the app catalogue but not linked in the database (ID mismatch). Re-save/publish the product from Inventory, then retry the GRN.`,
        )
      }
      resolvedProductIds.set(line.productId, resolved)
      await adjustStockLevel(tx, resolved, { onHand: line.qty })

      const poItemMatch = po
        ? resolveVendorBillPoItem(
            po.items.map(item => ({ id: item.id, productId: item.productId, description: item.description })),
            { productId: resolved, description: line.productName },
          )
        : undefined
      const poItem = po && poItemMatch ? po.items.find(item => item.id === poItemMatch.id) : undefined
      if (poItem) {
        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { qtyReceived: Math.min(poItem.qtyOrdered, poItem.qtyReceived + line.qty) },
        })
        if (grnId) {
          const grnItem = await tx.grnItem.create({
            data: {
              grnId,
              poItemId: poItem.id,
              productId: resolved,
              qtyReceived: line.qty,
              unitCost: poItem.unitCost,
            },
          })
          grnItemsByProductId.set(line.productId, grnItem.id)
        }
      }
    }

    // The GRN transaction owns purchase progress. Updating only the line
    // counters left the PO header at "confirmed"; the browser's later PATCH
    // was then rejected because confirmed → partial/received is not a legal
    // client-driven transition.
    if (po) {
      const refreshedItems = await tx.purchaseOrderItem.findMany({ where: { poId: po.id } })
      const allReceived = refreshedItems.length > 0
        && refreshedItems.every(item => item.qtyReceived >= item.qtyOrdered)
      const anyReceived = refreshedItems.some(item => item.qtyReceived > 0)
      if (anyReceived) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: allReceived ? 'received' : 'partial' },
        })
      }
    }
  })

  return { grnItemsByProductId, resolvedProductIds }
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
    if (product && isNonStockProduct(product)) continue
    // POS always sells from warehouse (shop = "With Issues", not a sales floor).
    const location: LocationId = 'warehouse'

    if (line.serialId || (product && isSerialTracking(inferTrackingMethod(product)))) {
      const serial = line.serialId
        ? serials.find(s => s.id === line.serialId)
        : serials.find(s =>
            s.productId === productId
            && String(s.serial || '').toLowerCase() === String(line.serialNumber || '').toLowerCase()
            && isOnHandSerialStatus(s.status),
          )
      if (!serial || !isOnHandSerialStatus(serial.status)) {
        return { ok: false, error: `Serial not available for ${line.productName || productId}` }
      }
      if (String(serial.location || '') !== 'warehouse') {
        return {
          ok: false,
          error: `Serial for ${line.productName || productId} is not at warehouse (at ${serial.location || 'unknown'})`,
        }
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
        product ?? { requiresSerial: false },
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

/**
 * Authoritative GRN stock in (after serial validation).
 *
 * The blob mutation (deed_products/deed_serials/deed_bulkStock/deed_stockMoves)
 * is serialized against the same 'deed_serials' advisory lock key that
 * POST /api/serials now takes (see app/api/serials/route.ts) — closing the
 * race documented in scripts/heal-grn-serials.mjs, where two concurrent
 * unlocked read-modify-writes on deed_serials could silently drop whichever
 * writer's appended serials lost the race. The relational side (StockLevel,
 * PurchaseOrderItem.qtyReceived, GoodsReceivedNote/GrnItem) runs inside one
 * prisma.$transaction via applyReceiptRelational so a failure there (e.g. an
 * unresolvable product) aborts before any blob write happens, instead of
 * leaving stock bumped with no matching relational record.
 */
export async function applyReceiptStockMutation(params: {
  receiptId: string
  receiptRef: string
  purchaseOrderId?: string
  destination: string
  supplierInvoiceNo?: string
  notes?: string
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
  return withAppStateKeyLock('deed_serials', async () => {
    const state = await loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
    const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
    const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
    let bulkStock: BulkStockLevel[] =
      Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
    const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []
    const newMoves: BlobStockMove[] = []
    const destination = asLocationId(params.destination || 'warehouse')
    const existingSerialKeys = new Set(serials.map(s => String(s.serial || '').toLowerCase()).filter(Boolean))
    const blobAlreadyPosted = stockMoves.some(m => m.documentRef === params.receiptRef)
    const existingMoves = stockMoves.filter(m => m.documentRef === params.receiptRef)

    if (!blobAlreadyPosted) {
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
          const product = products.find(p => p.id === productId)
          serials.push({
            ...(record || {}),
            id: String(record?.id || randomUUID()),
            serial: token,
            productId,
            status: String(record?.status || 'available'),
            location: String(record?.location || destination),
            specs: String(record?.specs || '').trim() || seedSerialSpecs({
              typedSpecs: record?.specs as string | undefined,
              productName,
              productSpecs: product?.specs,
              deviceConfig: product?.deviceConfig,
            }),
          } as BlobSerial)
        }
        const idx = products.findIndex(p => p.id === productId)
        if (idx >= 0) products[idx] = { ...products[idx], stockQty: Number(products[idx].stockQty ?? 0) + qty }
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
        newMoves.push({
          id: randomUUID(), type: 'in', productId, productName, qty,
          reason: `Receipt ${params.receiptRef}`, fromLocation: 'vendor', toLocation: destination,
          serialNumbers: [], date: nowIso(),
          userId: params.userId ?? 'system', documentRef: params.receiptRef,
        })
      }
      }
    }

    let grnItemsByProductId = new Map<string, string>()
    let resolvedProductIds = new Map<string, string>()
    try {
      const relational = await applyReceiptRelational({
        purchaseOrderId: params.purchaseOrderId,
        receiptRef: params.receiptRef,
        supplierInvoiceNo: params.supplierInvoiceNo,
        notes: params.notes,
        userId: params.userId,
        lines: params.lines.map(line => {
          const blob = products.find(p => p.id === String(line.productId || ''))
          return {
            productId: String(line.productId || ''),
            productName: line.productName || blob?.name || 'Item',
            qty: Math.max(0, Math.floor(Number(line.qtyReceived) || 0)),
            sku: blob?.sku,
            requiresSerial: line.requiresSerial || blob?.requiresSerial,
            trackingMethod: blob?.trackingMethod,
            costPrice: blob?.costPrice,
            sellingPrice: blob?.sellingPrice,
          }
        }),
      })
      grnItemsByProductId = relational.grnItemsByProductId
      resolvedProductIds = relational.resolvedProductIds
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stock update failed'
      if (isPrismaUniqueViolation(err) || message.includes('goods_received_notes_grn_number_key')) {
        return {
          ok: false,
          error: `${params.receiptRef} was already received. Refresh Purchase — if this GRN is still draft, retry once.`,
        }
      }
      return { ok: false, error: message }
    }

    if (!blobAlreadyPosted) {
      await saveStoreKeys({
        deed_products: JSON.stringify(products),
        deed_serials: JSON.stringify(serials),
        deed_bulkStock: JSON.stringify(bulkStock),
        deed_stockMoves: JSON.stringify([...newMoves, ...stockMoves]),
      })
    }

    // Best-effort relational SerialNumber mirror — deed_serials (just written
    // above, inside the lock) remains the source of truth for on-hand serial
    // state; a conflict/failure here only means this row predates this write
    // path or was already mirrored, and never blocks the GRN itself.
    for (const line of params.lines) {
      if (!line.requiresSerial) continue
      const productId = String(line.productId || '')
      const qty = Math.max(0, Math.floor(Number(line.qtyReceived) || 0))
      if (qty <= 0) continue
      const resolved = resolvedProductIds.get(productId)
      if (!resolved) continue
      const grnItemId = grnItemsByProductId.get(productId)
      const tokens = Array.isArray(line.serials) ? line.serials.map(s => String(s).trim()).filter(Boolean).slice(0, qty) : []
      for (const token of tokens) {
        const record = (line.serialRecords || []).find(r => String(r.serial || '').toLowerCase() === token.toLowerCase())
        await prisma.serialNumber.create({
          data: {
            id: String(record?.id || randomUUID()),
            productId: resolved,
            serialNumber: token,
            inventoryBarcode: (record?.barcode as string) || null,
            purchaseItemId: grnItemId || null,
            status: 'in_stock',
          },
        }).catch(() => { /* unique conflict — blob is SoR */ })
      }
    }

    void params.receiptId
    return { ok: true, moves: blobAlreadyPosted ? existingMoves : newMoves }
  })
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

    if ((product && isSerialTracking(inferTrackingMethod(product))) || serialIds.length > 0) {
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
      const locs = calcStockByLocation(product ?? { requiresSerial: false }, serials as any, bulkStock, productId)
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
    const product = products.find(p => p.id === params.productId)
    const locs = calcStockByLocation(product ?? { requiresSerial: false }, [], bulkStock, params.productId)
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

/**
 * Customer RMA receive — restore on-hand qty / mark serials returned@warehouse.
 * Authoritative blob + Prisma StockLevel writer (client must not re-increment).
 */
export async function applyCustomerReturnStockMutation(params: {
  returnRef: string
  lines: Array<{
    productId: string
    productName: string
    qty: number
    serialIds?: string[]
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
    const serialIds = Array.isArray(line.serialIds) ? line.serialIds : []
    if (serialIds.length > 0) {
      for (const sid of serialIds) {
        const serial = serials.find(s => s.id === sid)
        if (!serial) return { ok: false, error: `Serial missing for ${line.productName}` }
        serial.status = 'returned'
        serial.location = 'warehouse'
      }
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) {
        products[idx] = { ...products[idx], stockQty: Number(products[idx].stockQty ?? 0) + serialIds.length }
      }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) + serialIds.length)
      newMoves.push({
        id: randomUUID(), type: 'return', productId, productName: line.productName,
        qty: serialIds.length, reason: `Customer return ${params.returnRef}`,
        fromLocation: 'customer', toLocation: 'warehouse',
        serialNumbers: serialIds.map(id => serials.find(s => s.id === id)?.serial || id),
        date: nowIso(), userId: params.userId ?? 'system', documentRef: params.returnRef,
      })
    } else {
      bulkStock = upsertBulkStock(bulkStock, productId, 'warehouse', qty)
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) {
        products[idx] = { ...products[idx], stockQty: Number(products[idx].stockQty ?? 0) + qty }
      }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) + qty)
      newMoves.push({
        id: randomUUID(), type: 'return', productId, productName: line.productName,
        qty, reason: `Customer return ${params.returnRef}`,
        fromLocation: 'customer', toLocation: 'warehouse',
        serialNumbers: [], date: nowIso(), userId: params.userId ?? 'system', documentRef: params.returnRef,
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

/**
 * Vendor RTV — deduct on-hand / mark serials returned@vendor.
 */
export async function applyVendorReturnStockMutation(params: {
  returnRef: string
  lines: Array<{
    productId: string
    productName: string
    qty: number
    serialIds?: string[]
    requiresSerial?: boolean
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
    if (!productId) continue
    const serialIds = Array.isArray(line.serialIds) ? line.serialIds : []
    const qty = line.requiresSerial || serialIds.length > 0
      ? serialIds.length
      : Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue

    if (serialIds.length > 0) {
      for (const sid of serialIds) {
        const serial = serials.find(s => s.id === sid)
        if (!serial) return { ok: false, error: `Serial missing for ${line.productName}` }
        if (!isOnHandSerialStatus(serial.status) && serial.status !== 'assigned') {
          return { ok: false, error: `Serial ${serial.serial || sid} is not on hand` }
        }
        serial.status = 'returned'
        serial.location = 'vendor'
      }
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) {
        products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) - serialIds.length) }
      }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) - serialIds.length)
      newMoves.push({
        id: randomUUID(), type: 'return', productId, productName: line.productName,
        qty: serialIds.length, reason: `Vendor return ${params.returnRef}`,
        fromLocation: 'warehouse', toLocation: 'vendor',
        serialNumbers: serialIds.map(id => serials.find(s => s.id === id)?.serial || id),
        date: nowIso(), userId: params.userId ?? 'system', documentRef: params.returnRef,
      })
    } else {
      const product = products.find(p => p.id === productId)
      const locs = calcStockByLocation(product ?? { requiresSerial: false }, serials as any, bulkStock, productId)
      if (Number(locs.warehouse ?? 0) < qty) {
        return { ok: false, error: `Insufficient warehouse stock for ${line.productName}` }
      }
      bulkStock = upsertBulkStock(bulkStock, productId, 'warehouse', -qty)
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) {
        products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) - qty) }
      }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) - qty)
      newMoves.push({
        id: randomUUID(), type: 'return', productId, productName: line.productName,
        qty, reason: `Vendor return ${params.returnRef}`,
        fromLocation: 'warehouse', toLocation: 'vendor',
        serialNumbers: [], date: nowIso(), userId: params.userId ?? 'system', documentRef: params.returnRef,
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
