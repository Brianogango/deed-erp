import 'server-only'
import { isSalePickLocation, stockStageLabel } from '@/lib/inventory/sellable-stock'
import { pickVendorReturnSources } from '@/lib/inventory/vendor-return-source'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, notifyStoreKeysChanged, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { adjustStockLevel, createZeroStockLevel } from '@/lib/inventory/stock-level'
import { calcStockByLocation, upsertBulkStock } from '@/lib/business-logic'
import type { BulkStockLevel } from '@/lib/business-logic'
import type { LocationId } from '@/lib/store'
import { mirrorStockReservationsToPrisma } from '@/lib/inventory/reservation-mirror'
import { inferTrackingMethod, isSerialTracking } from '@/lib/inventory-identifiers'
import { isOnHandSerialStatus } from '@/lib/inventory/serial-status'
import { normalizeSaleStatus } from '@/lib/odoo-sales-flow'
import { seedSerialSpecs } from '@/lib/reconfiguration/unit-config'
import { isNonStockProduct } from '@/lib/sales/non-stock-line'
import { resolveVendorBillPoItem } from '@/lib/purchase/bill-po-line-match'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// pending_testing and quarantine were missing, so a transfer or receipt into
// them was silently turned into 'warehouse' — i.e. made sellable.
const VALID_LOCATIONS: LocationId[] = ['warehouse', 'shop', 'repair_unit', 'computer_aid', 'computer_aid_collected', 'computer_aid_issues', 'vendor', 'customer', 'employee', 'pending_testing', 'quarantine']

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

  // A delivery whose stock was already deducted by an earlier attempt of THIS
  // same delivery must not be refused. Validating writes stock first and the
  // delivery record afterwards, so an attempt that failed in between left the
  // serials sold while the delivery stayed open — every retry then hit
  // "serial … is not available for delivery" and the delivery could never be
  // completed. A line whose stock move already carries this delivery ref is
  // treated as done: it is neither re-validated nor deducted a second time.
  const movedProductIds = new Set(
    stockMoves
      .filter(m => m.documentRef === params.deliveryRef && m.type === 'out')
      .map(m => m.productId),
  )

  /**
   * True when this line's stock has already left: either a stock move carries
   * this delivery's ref, or every serial on the line is already sold against
   * this same sale order. Both mean an earlier attempt deducted it, so the
   * line is skipped rather than validated or deducted again.
   */
  const alreadyApplied = (line: { productId: string; serialIds?: string[] }) => {
    if (movedProductIds.has(line.productId)) return true
    const serialIds = Array.isArray(line.serialIds) ? line.serialIds : []
    if (!serialIds.length) return false
    return serialIds.every(id => {
      const serial = serials.find(s => s.id === id)
      return Boolean(serial && serial.status === 'sold' && serial.saleOrderId === params.saleOrderId)
    })
  }

  for (const line of params.lines) {
    if (alreadyApplied(line)) continue
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue

    const product = products.find(p => p.id === line.productId)
    if (!product || isNonStockProduct(product)) continue

    // Delivery notes ship sold goods: Ready for Sale only, whatever location
    // the client sends (lib/inventory/sellable-stock.ts). With Issues and
    // Refurbishment stock used to ship when the warehouse ran short.
    const location: LocationId = 'warehouse'
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
        // Older serial rows can lack a location; only a known other stage blocks.
        if (serial.location && !isSalePickLocation(serial.location)) {
          return {
            ok: false,
            error: `${line.productName}: serial ${serial.serial ?? serialId} is in ${stockStageLabel(serial.location)}, not Ready for Sale — move it to the warehouse once it has passed its checks`,
          }
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
    if (alreadyApplied(line)) continue
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue

    const productIdx = products.findIndex(p => p.id === line.productId)
    if (productIdx === -1) continue
    const product = products[productIdx]
    if (isNonStockProduct(product)) continue

    const location: LocationId = 'warehouse' // matches the check above: Ready for Sale only
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
  const reservedReleaseByProduct = new Map<string, number>()

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

    // The goods come back to the shelf as free stock (serials above go back
    // to 'available' too). The delivery's reservation is released, not
    // restored: it used to be set back to 'reserved', so bulk items came back
    // already held for the order and never showed as available. Preparing a
    // new delivery reserves again. Other deliveries of the same order
    // (backorders) keep their own reservations.
    const releasedAt = new Date().toISOString()
    for (let rIdx = 0; rIdx < stockReservations.length; rIdx++) {
      const reservation = stockReservations[rIdx]
      if (reservation.productId !== line.productId) continue
      const ownDelivery = reservation.deliveryId === params.deliveryId
      const orderLevelFulfilled = !reservation.deliveryId
        && reservation.referenceId === params.saleOrderId
        && Number(reservation.fulfilledQty ?? 0) > 0
      if (!ownDelivery && !orderLevelFulfilled) continue
      if (reservation.status === 'reserved' && isUuid(line.productId)) {
        const open = Math.max(0, Number(reservation.qty) - Number(reservation.fulfilledQty ?? 0))
        if (open > 0) reservedReleaseByProduct.set(line.productId, (reservedReleaseByProduct.get(line.productId) ?? 0) + open)
      }
      stockReservations[rIdx] = {
        ...reservation,
        status: 'cancelled',
        fulfilledQty: 0,
        fulfilledDate: undefined,
        releasedDate: releasedAt,
        notes: `${(reservation as any).notes ?? ''} · released: delivery ${params.deliveryRef} reversed`.trim(),
      } as BlobReservation
    }
  }

  const remainingMoves = stockMoves.filter(m => m.documentRef !== params.deliveryRef)

  try {
    await prisma.$transaction(async tx => {
      for (const [productId, delta] of stockLevelDeltas) {
        await adjustStockLevel(tx, productId, { onHand: delta, reserved: -(reservedReleaseByProduct.get(productId) ?? 0) })
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

/**
 * Cancelling a delivery that was prepared but never shipped: its reserved
 * quantities go back to free stock. Returns how many units were released.
 */
export async function releaseDeliveryReservations(params: {
  deliveryId: string
  deliveryRef: string
}): Promise<number> {
  const state = await loadAppState(['deed_stockReservations'])
  const reservations: BlobReservation[] =
    Array.isArray(state.deed_stockReservations) ? [...(state.deed_stockReservations as BlobReservation[])] : []
  const releasedAt = new Date().toISOString()
  const byProduct = new Map<string, number>()
  let released = 0
  for (let i = 0; i < reservations.length; i++) {
    const r = reservations[i]
    if (r.deliveryId !== params.deliveryId || r.status !== 'reserved') continue
    const open = Math.max(0, Number(r.qty) - Number(r.fulfilledQty ?? 0))
    reservations[i] = {
      ...r,
      status: 'cancelled',
      releasedDate: releasedAt,
      notes: `${(r as any).notes ?? ''} · released: delivery ${params.deliveryRef} cancelled`.trim(),
    } as BlobReservation
    released += open
    if (open > 0 && isUuid(r.productId)) byProduct.set(r.productId, (byProduct.get(r.productId) ?? 0) + open)
  }
  if (!released) return 0
  await saveStoreKeys({ deed_stockReservations: JSON.stringify(reservations) })
  try {
    await prisma.$transaction(async tx => {
      for (const [productId, qty] of byProduct) await adjustStockLevel(tx, productId, { reserved: -qty })
    })
  } catch (err) {
    // The reservations above are released; the reserved counter heals on the next stock recount.
    console.error('[releaseDeliveryReservations] stock level update failed:', err)
  }
  return released
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
  lines: Array<{ productId: string; productName: string; qty: number; poLineId?: string; sku?: string; requiresSerial?: boolean; trackingMethod?: string; costPrice?: number; sellingPrice?: number }>
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

      // Which PO lines this receipt line fills. The named PO line first, then
      // the product's other lines in order, each up to what is still open on
      // it. A product on two PO lines used to match neither ("ambiguous"), so
      // the order never showed those goods as received and could not be billed.
      const targets: NonNullable<typeof po>['items'] = []
      if (po) {
        const named = line.poLineId ? po.items.find(item => item.id === line.poLineId) : undefined
        if (named) targets.push(named)
        for (const item of po.items) if (item.productId === resolved && item !== named) targets.push(item)
        if (!targets.length) {
          const byName = resolveVendorBillPoItem(
            po.items.map(item => ({ id: item.id, productId: item.productId, description: item.description })),
            { productId: resolved, description: line.productName },
          )
          const hit = byName ? po.items.find(item => item.id === byName.id) : undefined
          if (hit) targets.push(hit)
        }
      }
      let remaining = line.qty
      for (const poItem of targets) {
        if (remaining <= 0) break
        const open = Math.max(0, poItem.qtyOrdered - poItem.qtyReceived)
        const take = targets.length === 1 ? remaining : Math.min(remaining, open)
        if (take <= 0) continue
        poItem.qtyReceived = Math.min(poItem.qtyOrdered, poItem.qtyReceived + take)
        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: { qtyReceived: poItem.qtyReceived },
        })
        remaining -= take
        if (grnId) {
          const grnItem = await tx.grnItem.create({
            data: {
              grnId,
              poItemId: poItem.id,
              productId: resolved,
              qtyReceived: take,
              unitCost: poItem.unitCost,
            },
          })
          if (!grnItemsByProductId.has(line.productId)) grnItemsByProductId.set(line.productId, grnItem.id)
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
  /** Prefix for the stock-move reason; defaults to "POS" (Kilimall dispatches pass "Kilimall"). */
  reasonLabel?: string
  lines: Array<{
    productId: string
    productName: string
    qty: number
    serialId?: string
    serialNumber?: string
    sourceLocation?: string
  }>
  userId?: string
}): Promise<{ ok: true; moves: BlobStockMove[]; alreadyApplied?: boolean } | { ok: false; error: string }> {
  // Under the serial lock (like receipts): two tills selling the same unit
  // at once could otherwise both see it available and both sell it.
  return withAppStateKeyLock('deed_serials', async () => {
    const state = await loadAppState(['deed_products', 'deed_serials', 'deed_bulkStock', 'deed_stockMoves'])
    const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
    const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
    let bulkStock: BulkStockLevel[] =
      Array.isArray(state.deed_bulkStock) ? [...(state.deed_bulkStock as BulkStockLevel[])] : []
    const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []
    const newMoves: BlobStockMove[] = []
    // A retry of a sale the server already took (the till lost the reply)
    // must not take the stock a second time.
    const label = `${params.reasonLabel || 'POS'} ${params.orderRef}`
    const already = stockMoves.filter(m => m.documentRef === params.orderRef && String(m.reason ?? '') === label)
    if (already.length) return { ok: true, moves: already, alreadyApplied: true }
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
          qty: 1, reason: `${params.reasonLabel || 'POS'} ${params.orderRef}`, fromLocation: location, toLocation: 'customer',
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
          qty, reason: `${params.reasonLabel || 'POS'} ${params.orderRef}`, fromLocation: location, toLocation: 'customer',
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
  })
}

export interface KilimallSerialRepairItem {
  dispatchRef: string
  orderRef: string
  productName: string
  serialNumber: string
  /** Serial status found on the server, or "missing". */
  found: string
  location: string
  action: 'mark_sold' | 'serial_missing'
}

/**
 * Every dispatched Kilimall order must have its serial marked sold. Finds the
 * dispatches whose serial is not sold (a stale browser copy of the serial register can
 * write one back to available) and, when `apply` is true, marks them sold, takes the
 * unit out of the product's on-hand and writes a stock move. Dry run by default.
 */
export async function reconcileKilimallDispatchSerials(params: {
  apply: boolean
  userId?: string
}): Promise<{ ok: true; items: KilimallSerialRepairItem[]; applied: number } | { ok: false; error: string }> {
  return withAppStateKeyLock('deed_serials', async () => {
    const state = await loadAppState(['deed_kilimallDispatches', 'deed_serials', 'deed_products', 'deed_stockMoves'])
    const dispatches = Array.isArray(state.deed_kilimallDispatches) ? (state.deed_kilimallDispatches as Array<Record<string, any>>) : []
    const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
    const products: BlobProduct[] = Array.isArray(state.deed_products) ? [...(state.deed_products as BlobProduct[])] : []
    const stockMoves: BlobStockMove[] = Array.isArray(state.deed_stockMoves) ? [...(state.deed_stockMoves as BlobStockMove[])] : []

    const items: KilimallSerialRepairItem[] = []
    const newMoves: BlobStockMove[] = []
    const stockLevelDeltas = new Map<string, number>()

    for (const d of dispatches) {
      if (d.status !== 'dispatched') continue
      const serial = serials.find(x => x.id === d.serialId)
        || serials.find(x => x.productId === d.productId && String(x.serial || '').toLowerCase() === String(d.serialNumber || '').toLowerCase())
      const base = {
        dispatchRef: String(d.ref || ''),
        orderRef: String(d.orderRef || ''),
        productName: String(d.productName || ''),
        serialNumber: String(d.serialNumber || ''),
      }
      if (!serial) { items.push({ ...base, found: 'missing', location: '-', action: 'serial_missing' }); continue }
      if (String(serial.status || '').toLowerCase() === 'sold') continue
      items.push({ ...base, found: String(serial.status || ''), location: String(serial.location || ''), action: 'mark_sold' })
      if (!params.apply) continue

      const wasOnHand = isOnHandSerialStatus(serial.status)
      const fromLocation = String(serial.location || 'warehouse')
      serial.status = 'sold'
      serial.location = 'customer'
      serial.soldDate = String(d.dispatchDate || d.date || nowIso())
      if (wasOnHand) {
        const idx = products.findIndex(p => p.id === serial.productId)
        if (idx >= 0) products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) - 1) }
        stockLevelDeltas.set(serial.productId, (stockLevelDeltas.get(serial.productId) ?? 0) - 1)
      }
      newMoves.push({
        id: randomUUID(), type: 'out', productId: serial.productId, productName: base.productName || 'Item',
        qty: 1, reason: `Kilimall ${base.orderRef || base.dispatchRef} (serial correction)`,
        fromLocation: fromLocation as LocationId, toLocation: 'customer' as LocationId,
        serialNumbers: [base.serialNumber].filter(Boolean),
        date: nowIso(), userId: params.userId ?? 'system', documentRef: base.orderRef || base.dispatchRef,
      })
    }

    if (!params.apply || newMoves.length === 0) return { ok: true as const, items, applied: 0 }
    await bumpPrismaOnHand(stockLevelDeltas)
    await saveStoreKeys({
      deed_products: JSON.stringify(products),
      deed_serials: JSON.stringify(serials),
      deed_stockMoves: JSON.stringify([...newMoves, ...stockMoves]),
    })
    return { ok: true as const, items, applied: newMoves.length }
  })
}

export interface StaleSerialHold {
  serial: string
  productName: string
  status: string
  orderRef: string
  orderStatus: string
  reason: string
}

/**
 * Serials still held (assigned/reserved) for a sales order that no longer needs them: the order
 * is cancelled, was set back to a quotation, or no longer exists. Cancelling or resetting an
 * order used to free only the serials listed on its order lines, not the ones claimed when its
 * delivery was prepared, so those stayed held for ever. Dry run by default.
 */
export async function releaseStaleSerialHolds(params: {
  apply: boolean
}): Promise<{ ok: true; items: StaleSerialHold[]; released: number } | { ok: false; error: string }> {
  return withAppStateKeyLock('deed_serials', async () => {
    const state = await loadAppState(['deed_serials', 'deed_saleOrders', 'deed_products'])
    const serials: BlobSerial[] = Array.isArray(state.deed_serials) ? [...(state.deed_serials as BlobSerial[])] : []
    const orders = Array.isArray(state.deed_saleOrders) ? (state.deed_saleOrders as Array<Record<string, any>>) : []
    const products = Array.isArray(state.deed_products) ? (state.deed_products as Array<Record<string, any>>) : []
    const orderById = new Map(orders.map(o => [String(o.id), o]))
    const productName = new Map(products.map(p => [String(p.id), String(p.name ?? '')]))
    const dead = new Set(['cancelled', 'quotation', 'quotation_sent'])

    const items: StaleSerialHold[] = []
    let released = 0
    for (const serial of serials) {
      const status = String(serial.status || '').toLowerCase()
      if (!['assigned', 'reserved'].includes(status) || !serial.saleOrderId) continue
      const order = orderById.get(String(serial.saleOrderId))
      const orderStatus = order ? normalizeSaleStatus(order.status) : 'missing'
      if (order && !dead.has(orderStatus)) continue
      items.push({
        serial: String(serial.serial || ''),
        productName: productName.get(String(serial.productId)) || '',
        status,
        orderRef: String(order?.ref ?? order?.orderNumber ?? serial.saleOrderId),
        orderStatus,
        reason: order ? `Held for an order that is ${orderStatus.replace('_', ' ')}` : 'Held for an order that no longer exists',
      })
      if (params.apply) {
        serial.status = 'available'
        serial.saleOrderId = undefined
        released += 1
      }
    }
    if (params.apply && released > 0) {
      await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
    }
    return { ok: true as const, items, released }
  })
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
    poLineId?: string
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
            poLineId: line.poLineId,
            sku: blob?.sku,
            requiresSerial: line.requiresSerial || blob?.requiresSerial,
            trackingMethod: blob?.trackingMethod,
            costPrice: blob?.costPrice,
            sellingPrice: blob?.sellingPrice,
          }
        }),
      })
      grnItemsByProductId = relational.grnItemsByProductId
      // The order's received counts and status changed in its table.
      if (params.purchaseOrderId) await notifyStoreKeysChanged(['deed_purchaseOrders'])
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
  /** The return's reason decides which stage bulk stock comes out of first. */
  reason?: string
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
      }
      // Record where each unit really left from (a faulty unit is usually in
      // With Issues or Quarantine, not the warehouse).
      const fromBySerial = new Map(serialIds.map(sid => [sid, String(serials.find(s => s.id === sid)?.location || 'warehouse')]))
      for (const sid of serialIds) {
        const serial = serials.find(s => s.id === sid)!
        serial.status = 'returned'
        serial.location = 'vendor'
      }
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) {
        products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) - serialIds.length) }
      }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) - serialIds.length)
      for (const from of new Set(fromBySerial.values())) {
        const ids = serialIds.filter(id => fromBySerial.get(id) === from)
        newMoves.push({
          id: randomUUID(), type: 'return', productId, productName: line.productName,
          qty: ids.length, reason: `Vendor return ${params.returnRef}`,
          fromLocation: from, toLocation: 'vendor',
          serialNumbers: ids.map(id => serials.find(s => s.id === id)?.serial || id),
          date: nowIso(), userId: params.userId ?? 'system', documentRef: params.returnRef,
        })
      }
    } else {
      const product = products.find(p => p.id === productId)
      const locs = calcStockByLocation(product ?? { requiresSerial: false }, serials as any, bulkStock, productId)
      const sourced = pickVendorReturnSources(locs as Record<string, number>, qty, params.reason)
      if (!sourced.ok) {
        return { ok: false, error: `Only ${sourced.available} ${line.productName} on hand to return (asked for ${qty})` }
      }
      for (const pick of sourced.picks) bulkStock = upsertBulkStock(bulkStock, productId, pick.location, -pick.qty)
      const idx = products.findIndex(p => p.id === productId)
      if (idx >= 0) {
        products[idx] = { ...products[idx], stockQty: Math.max(0, Number(products[idx].stockQty ?? 0) - qty) }
      }
      stockLevelDeltas.set(productId, (stockLevelDeltas.get(productId) ?? 0) - qty)
      for (const pick of sourced.picks) {
        newMoves.push({
          id: randomUUID(), type: 'return', productId, productName: line.productName,
          qty: pick.qty, reason: `Vendor return ${params.returnRef}`,
          fromLocation: pick.location, toLocation: 'vendor',
          serialNumbers: [], date: nowIso(), userId: params.userId ?? 'system', documentRef: params.returnRef,
        })
      }
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
