import 'server-only'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import {
  findDuplicateProductGroups,
  pickKeepProduct,
  planArchivedProductIdentity,
  rewriteProductIdsInRecords,
  type DuplicateProductGroup,
  type DuplicateProductMember,
} from '@/lib/inventory/duplicate-products'

const PRODUCT_ID_MODELS: Array<[string, string]> = [
  ['serialNumber', 'productId'],
  ['stockMovement', 'productId'],
  ['stockReservation', 'productId'],
  ['stockAdjustmentItem', 'productId'],
  ['purchaseOrderItem', 'productId'],
  ['grnItem', 'productId'],
  ['quoteItem', 'productId'],
  ['invoiceItem', 'productId'],
  ['deliveryNoteItem', 'productId'],
  ['repairPart', 'productId'],
  ['posTransactionItem', 'productId'],
  ['kilimallOrderItem', 'productId'],
  ['saleOrderItem', 'productId'],
  ['customerAsset', 'productId'],
  ['valuationEvent', 'productId'],
  ['priceListItem', 'productId'],
  ['reconfigurationWorkOrder', 'productId'],
  ['deviceComponentInstallation', 'componentProductId'],
  ['reconfigurationRemovalLine', 'componentProductId'],
  ['reconfigurationInstallationLine', 'componentProductId'],
]

const BLOB_PRODUCT_KEYS = [
  'deed_products',
  'deed_serials',
  'deed_bulkStock',
  'deed_stockMoves',
  'deed_stockMovements',
  'deed_purchaseOrders',
  'deed_receipts',
  'deed_invoices',
  'deed_quotes',
  'deed_saleOrders',
  'deed_deliveries',
  'deed_repairs_v2',
  'deed_posOrders',
  'deed_adjustments',
]

async function rewriteProductIdsInBlobs(fromId: string, toId: string): Promise<void> {
  const state = await loadAppState(BLOB_PRODUCT_KEYS)
  const next: Record<string, string> = {}
  for (const key of BLOB_PRODUCT_KEYS) {
    const current = state[key]
    if (!Array.isArray(current)) continue
    const rewritten = rewriteProductIdsInRecords(current, fromId, toId)
    if (JSON.stringify(rewritten) !== JSON.stringify(current)) {
      next[key] = JSON.stringify(rewritten)
    }
  }
  if (Object.keys(next).length) await saveStoreKeys(next)
}

async function countProductRefs(id: string): Promise<number> {
  const counts = await Promise.all([
    prisma.serialNumber.count({ where: { productId: id } }).catch(() => 0),
    prisma.stockMovement.count({ where: { productId: id } }).catch(() => 0),
    prisma.invoiceItem.count({ where: { productId: id } }).catch(() => 0),
    prisma.saleOrderItem.count({ where: { productId: id } }).catch(() => 0),
    prisma.purchaseOrderItem.count({ where: { productId: id } }).catch(() => 0),
  ])
  return counts.reduce((sum, n) => sum + n, 0)
}

export async function listDuplicateProductGroups(): Promise<DuplicateProductGroup[]> {
  const rows = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const members: DuplicateProductMember[] = await Promise.all(rows.map(async row => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode ?? '',
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    refCount: await countProductRefs(row.id),
  })))
  return findDuplicateProductGroups(members)
}

async function mergeUniqueRow(
  tx: any,
  model: string,
  keepId: string,
  dropId: string,
  mergeQty?: (keep: any, drop: any) => Record<string, unknown>,
) {
  if (typeof tx[model]?.findUnique !== 'function') return
  const [keep, drop] = await Promise.all([
    tx[model].findUnique({ where: { productId: keepId } }),
    tx[model].findUnique({ where: { productId: dropId } }),
  ])
  if (!drop) return
  if (!keep) {
    await tx[model].update({ where: { productId: dropId }, data: { productId: keepId } })
    return
  }
  if (mergeQty) {
    await tx[model].update({ where: { productId: keepId }, data: mergeQty(keep, drop) })
  }
  await tx[model].delete({ where: { productId: dropId } })
}

async function reassignProductForeignKeys(tx: any, dropId: string, keepId: string) {
  for (const [model, field] of PRODUCT_ID_MODELS) {
    if (typeof tx[model]?.updateMany !== 'function') continue
    await tx[model].updateMany({
      where: { [field]: dropId },
      data: { [field]: keepId },
    })
  }
  await mergeUniqueRow(tx, 'stockLevel', keepId, dropId, (keep, drop) => ({
    qtyOnHand: Number(keep.qtyOnHand || 0) + Number(drop.qtyOnHand || 0),
    qtyReserved: Number(keep.qtyReserved || 0) + Number(drop.qtyReserved || 0),
    qtyOnOrder: Number(keep.qtyOnOrder || 0) + Number(drop.qtyOnOrder || 0),
  }))
  await mergeUniqueRow(tx, 'productValuation', keepId, dropId)
  if (typeof tx.kilimallListing?.deleteMany === 'function') {
    await tx.kilimallListing.deleteMany({ where: { productId: dropId } })
  }
  if (typeof tx.productImage?.updateMany === 'function') {
    const keepImages = await tx.productImage.findMany({ where: { productId: keepId } }).catch(() => [])
    if (keepImages.length >= 2) {
      await tx.productImage.deleteMany({ where: { productId: dropId } })
    } else {
      await tx.productImage.updateMany({ where: { productId: dropId }, data: { productId: keepId } })
    }
  }
  if (typeof tx.bulkStockLevel?.findMany === 'function') {
    const dropLevels = await tx.bulkStockLevel.findMany({ where: { productId: dropId } })
    for (const level of dropLevels) {
      const existing = await tx.bulkStockLevel.findUnique({
        where: { productId_location: { productId: keepId, location: level.location } },
      }).catch(() => null)
      if (existing) {
        await tx.bulkStockLevel.update({
          where: { id: existing.id },
          data: { qty: Number(existing.qty || 0) + Number(level.qty || 0) },
        })
        await tx.bulkStockLevel.delete({ where: { id: level.id } })
      } else {
        await tx.bulkStockLevel.update({
          where: { id: level.id },
          data: { productId: keepId },
        })
      }
    }
  }
  if (typeof tx.inventoryBatch?.findMany === 'function') {
    const dropBatches = await tx.inventoryBatch.findMany({ where: { productId: dropId } })
    for (const batch of dropBatches) {
      const existing = await tx.inventoryBatch.findUnique({
        where: { productId_batchNumber: { productId: keepId, batchNumber: batch.batchNumber } },
      }).catch(() => null)
      if (existing) {
        await tx.inventoryBatch.update({
          where: { id: existing.id },
          data: {
            quantityReceived: Number(existing.quantityReceived || 0) + Number(batch.quantityReceived || 0),
            quantityAvailable: Number(existing.quantityAvailable || 0) + Number(batch.quantityAvailable || 0),
          },
        })
        await tx.inventoryBatch.delete({ where: { id: batch.id } })
      } else {
        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: { productId: keepId },
        })
      }
    }
  }
}

function uniqueConstraintError(error: unknown): string | null {
  if (!error || typeof error !== 'object' || (error as { code?: string }).code !== 'P2002') return null
  const target = (error as { meta?: { target?: unknown } }).meta?.target
  const fields = Array.isArray(target) ? target.join(', ') : typeof target === 'string' ? target : ''
  if (fields.includes('barcode') || fields.includes('sku')) {
    return 'Could not merge — SKU or barcode already exists on another product'
  }
  return 'Could not merge — a unique inventory field already exists on the keeper'
}

export async function mergeDuplicateProducts(opts: {
  keepId: string
  dropId: string
}): Promise<{ ok: true; keepId: string; dropId: string } | { ok: false; error: string }> {
  if (opts.keepId === opts.dropId) return { ok: false, error: 'Same product' }
  const [keep, drop] = await Promise.all([
    prisma.product.findUnique({ where: { id: opts.keepId } }),
    prisma.product.findUnique({ where: { id: opts.dropId } }),
  ])
  if (!keep || !drop) return { ok: false, error: 'Product not found' }

  const identityCodes = await prisma.product.findMany({ select: { sku: true, barcode: true } })
  const archived = planArchivedProductIdentity({
    drop: { id: drop.id, sku: drop.sku, barcode: drop.barcode, name: drop.name },
    keep: { barcode: keep.barcode },
    takenSkus: identityCodes.map(row => row.sku),
    takenBarcodes: identityCodes.map(row => row.barcode).filter((code): code is string => Boolean(code)),
  })

  try {
    await prisma.$transaction(async tx => {
      if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          `product-merge:${[opts.keepId, opts.dropId].sort().join(':')}`,
        )
      }
      // Free the drop SKU/barcode before copying anything onto the keeper.
      // Copying first hits Product.barcode / Product.sku unique constraints (P2002).
      await tx.product.update({
        where: { id: drop.id },
        data: {
          isActive: false,
          sku: archived.sku,
          barcode: archived.barcode,
          name: archived.name,
        },
      })
      const enrich: Record<string, unknown> = {}
      if (archived.copyBarcodeToKeep && drop.barcode) enrich.barcode = drop.barcode
      if (!keep.description && drop.description) enrich.description = drop.description
      if (!keep.primaryImageUrl && drop.primaryImageUrl) enrich.primaryImageUrl = drop.primaryImageUrl
      if (Object.keys(enrich).length) {
        await tx.product.update({ where: { id: keep.id }, data: enrich })
      }
      await reassignProductForeignKeys(tx, drop.id, keep.id)
    })
  } catch (error) {
    const message = uniqueConstraintError(error)
    if (message) return { ok: false, error: message }
    throw error
  }

  try {
    await rewriteProductIdsInBlobs(drop.id, keep.id)
  } catch (error) {
    console.error('[products] Failed to rewrite blob product ids after merge:', error)
  }

  return { ok: true, keepId: keep.id, dropId: drop.id }
}

export async function mergeObviousDuplicateProducts(opts?: { dryRun?: boolean }) {
  const groups = await listDuplicateProductGroups()
  const planned: Array<{ keepId: string; dropId: string; key: string }> = []
  for (const group of groups) {
    const keep = pickKeepProduct(group.members)
    for (const member of group.members) {
      if (member.id === keep.id) continue
      planned.push({ keepId: keep.id, dropId: member.id, key: group.key })
    }
  }
  if (opts?.dryRun) {
    return { dryRun: true, groups: groups.length, merges: planned.length }
  }
  let merged = 0
  const errors: string[] = []
  const seen = new Set<string>()
  for (const item of planned) {
    if (seen.has(item.dropId)) continue
    seen.add(item.dropId)
    const result = await mergeDuplicateProducts({ keepId: item.keepId, dropId: item.dropId })
    if (result.ok) merged += 1
    else errors.push(result.error)
  }
  return { dryRun: false, groups: groups.length, merges: merged, errors }
}
