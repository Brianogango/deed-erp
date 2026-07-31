import 'server-only'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { loadAppState } from '@/lib/server-store'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'
import {
  applyDeliveryAverage,
  applyReceiptAverage,
  consumeBatchesFIFO,
  stockValuationEventKey,
  stockValuationJournalRef,
} from '@/lib/inventory/valuation-math'

/**
 * Deed CoA does not have a dedicated GRNI code. Accruals (3201) is the closest
 * live liability bucket for "goods received, bill not yet posted".
 */
const GRNI_ACCOUNT_LABEL = '3201 - Accruals'
const DEFAULT_WAREHOUSE_ID = 'main'

export type CostingMethod = 'average' | 'fifo' | 'standard'

async function productExists(productId: string): Promise<boolean> {
  const row = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  return Boolean(row)
}

async function resolveCostingMethod(productId: string): Promise<CostingMethod> {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { costingMethod: true },
    })
    if (product?.costingMethod === 'fifo' || product?.costingMethod === 'standard') {
      return product.costingMethod
    }
  } catch { /* column may be missing pre-migration */ }

  try {
    const state = await loadAppState(['deed_systemSettings'])
    const ss = state.deed_systemSettings as { invCostingMethod?: CostingMethod } | null
    if (ss?.invCostingMethod === 'fifo' || ss?.invCostingMethod === 'standard') {
      return ss.invCostingMethod
    }
  } catch { /* default average */ }

  return 'average'
}

async function alreadyProcessed(eventKey: string): Promise<boolean> {
  try {
    const row = await prisma.valuationEvent.findUnique({ where: { eventKey }, select: { id: true } })
    return Boolean(row)
  } catch {
    const journalRef = eventKey.replace(/^VAL\//, 'JRN/STK/')
    try {
      const je = await prisma.journalEntry.findUnique({ where: { ref: journalRef.slice(0, 80) }, select: { id: true } })
      return Boolean(je)
    } catch {
      return false
    }
  }
}

async function markProcessed(params: {
  eventKey: string
  kind: string
  productId: string
  qty: number
  unitCost: number
  reference?: string
}) {
  try {
    await prisma.valuationEvent.create({
      data: {
        eventKey: params.eventKey,
        kind: params.kind,
        productId: params.productId,
        qty: params.qty,
        unitCost: params.unitCost,
        reference: params.reference ? String(params.reference).slice(0, 80) : null,
      },
    })
  } catch {
    // Unique violation = already processed; other errors ignored (soak-safe)
  }
}

async function resolveStockAccounts(_productId: string) {
  return {
    inventoryLabel: formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.inventoryAccountCode, []),
    cogsLabel: formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.cogsAccountCode, []),
  }
}

async function upsertFifoBatch(params: {
  productId: string
  qty: number
  unitCost: number
  reference: string
  warehouseId?: string
}) {
  const batchNumber = `RCV-${params.reference}`.slice(0, 100)
  const existing = await prisma.inventoryBatch.findFirst({
    where: { productId: params.productId, batchNumber },
  })
  if (existing) {
    await prisma.inventoryBatch.update({
      where: { id: existing.id },
      data: {
        quantityReceived: existing.quantityReceived + params.qty,
        quantityAvailable: existing.quantityAvailable + params.qty,
        unitCost: params.unitCost,
      },
    })
    return existing.id
  }
  const created = await prisma.inventoryBatch.create({
    data: {
      batchNumber,
      productId: params.productId,
      warehouseId: params.warehouseId ?? DEFAULT_WAREHOUSE_ID,
      quantityReceived: params.qty,
      quantityAvailable: params.qty,
      unitCost: params.unitCost,
      receivedAt: new Date(),
    },
  })
  return created.id
}

async function syncProductValuationFromBatches(productId: string) {
  const batches = await prisma.inventoryBatch.findMany({
    where: { productId, quantityAvailable: { gt: 0 } },
    select: { quantityAvailable: true, unitCost: true },
  })
  const totalQty = batches.reduce((s, b) => s + b.quantityAvailable, 0)
  const totalValue = batches.reduce((s, b) => s + b.quantityAvailable * Number(b.unitCost ?? 0), 0)
  const averageCost = totalQty > 0 ? totalValue / totalQty : 0
  await prisma.productValuation.upsert({
    where: { productId },
    create: { productId, averageCost, totalQty, totalValue },
    update: { averageCost, totalQty, totalValue },
  })
  return { totalQty, totalValue, averageCost }
}

/**
 * Weighted-average or FIFO cost on stock receipt.
 * Dual-writes valuation + optional STK journal. Never touches app_state blobs.
 * Idempotent on (reference, productId).
 */
export async function processStockReceipt(params: {
  productId: string
  qty: number
  unitCost: number
  movementId?: string | null
  reference?: string
  userId?: string
  postJournal?: boolean
  warehouseId?: string
}) {
  if (!(await productExists(params.productId))) {
    return { skipped: true as const, reason: 'product_not_in_prisma' }
  }

  const costingMethod = await resolveCostingMethod(params.productId)
  const eventKey = stockValuationEventKey('receipt', params.reference || params.movementId || '', params.productId)
  if (await alreadyProcessed(eventKey)) {
    const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
    return {
      skipped: true as const,
      reason: 'already_processed',
      averageCost: Number(valuation?.averageCost ?? 0),
      totalQty: valuation?.totalQty ?? 0,
      totalValue: Number(valuation?.totalValue ?? 0),
    }
  }

  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  const unitCost = Math.max(0, Number(params.unitCost) || 0)
  if (qty <= 0) throw new Error('Receipt qty must be positive')

  let applied: ReturnType<typeof applyReceiptAverage>
  if (costingMethod === 'fifo') {
    await upsertFifoBatch({
      productId: params.productId,
      qty,
      unitCost,
      reference: String(params.reference || params.movementId || 'noref'),
      warehouseId: params.warehouseId,
    })
    const synced = await syncProductValuationFromBatches(params.productId)
    applied = {
      qty,
      unitCost,
      averageCost: synced.averageCost,
      totalQty: synced.totalQty,
      totalValue: synced.totalValue,
      totalCost: qty * unitCost,
    }
  } else {
    const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
    applied = applyReceiptAverage({
      currentQty: valuation?.totalQty ?? 0,
      currentValue: Number(valuation?.totalValue ?? 0),
      qty,
      unitCost,
    })
    await prisma.productValuation.upsert({
      where: { productId: params.productId },
      create: {
        productId: params.productId,
        averageCost: applied.averageCost,
        totalQty: applied.totalQty,
        totalValue: applied.totalValue,
      },
      update: {
        averageCost: applied.averageCost,
        totalQty: applied.totalQty,
        totalValue: applied.totalValue,
      },
    })
  }

  if (params.movementId) {
    try {
      await prisma.stockMovement.update({
        where: { id: params.movementId },
        data: { unitCost: applied.unitCost },
      })
    } catch {
      // movement may live only in app_state — ignore
    }
  }

  if (params.postJournal !== false && applied.totalCost > 0) {
    const { inventoryLabel } = await resolveStockAccounts(params.productId)
    await createJournalEntry({
      ref: stockValuationJournalRef('receipt', params.reference || params.movementId || '', params.productId),
      journalCode: 'STK',
      description: `Stock receipt ${applied.qty} @ ${applied.unitCost}${costingMethod === 'fifo' ? ' (FIFO)' : ''}`,
      sourceType: 'stock_receipt',
      sourceId: params.reference || params.movementId || params.productId,
      createdById: params.userId,
      skipIfExists: true,
      lines: [
        { accountLabel: inventoryLabel, label: 'Inventory receipt', debit: applied.totalCost, credit: 0 },
        { accountLabel: GRNI_ACCOUNT_LABEL, label: 'GRNI / Accruals', debit: 0, credit: applied.totalCost },
      ],
    })
  }

  await markProcessed({
    eventKey,
    kind: 'receipt',
    productId: params.productId,
    qty: applied.qty,
    unitCost: applied.unitCost,
    reference: params.reference,
  })

  return {
    skipped: false as const,
    costingMethod,
    averageCost: applied.averageCost,
    totalQty: applied.totalQty,
    totalValue: applied.totalValue,
  }
}

/**
 * Delivery / outbound: reduce valuation at average or FIFO cost; post COGS.
 * Idempotent on (reference, productId). Never touches app_state blobs.
 */
export async function processStockDelivery(params: {
  productId: string
  qty: number
  movementId?: string | null
  reference?: string
  userId?: string
  postJournal?: boolean
}) {
  if (!(await productExists(params.productId))) {
    return { skipped: true as const, reason: 'product_not_in_prisma' }
  }

  const costingMethod = await resolveCostingMethod(params.productId)
  const eventKey = stockValuationEventKey('delivery', params.reference || params.movementId || '', params.productId)
  if (await alreadyProcessed(eventKey)) {
    const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
    return {
      skipped: true as const,
      reason: 'already_processed',
      averageCost: Number(valuation?.averageCost ?? 0),
      unitCostUsed: Number(valuation?.averageCost ?? 0),
      totalCost: 0,
      totalQty: valuation?.totalQty ?? 0,
      totalValue: Number(valuation?.totalValue ?? 0),
    }
  }

  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  if (qty <= 0) throw new Error('Delivery qty must be positive')

  let applied: ReturnType<typeof applyDeliveryAverage>
  let unitCostUsed = 0

  if (costingMethod === 'fifo') {
    const batches = await prisma.inventoryBatch.findMany({
      where: { productId: params.productId, quantityAvailable: { gt: 0 } },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    })
    const fifo = consumeBatchesFIFO(
      batches.map(b => ({
        id: b.id,
        quantityAvailable: b.quantityAvailable,
        unitCost: Number(b.unitCost ?? 0),
        receivedAt: b.receivedAt,
      })),
      qty,
    )
    if (fifo.shortfall > 0) {
      throw new Error(`Insufficient FIFO layers for product ${params.productId}: short ${fifo.shortfall}`)
    }
    for (const line of fifo.consumed) {
      const batch = batches.find(b => b.id === line.batchId)
      if (!batch) continue
      await prisma.inventoryBatch.update({
        where: { id: line.batchId },
        data: { quantityAvailable: batch.quantityAvailable - line.qty },
      })
    }
    const synced = await syncProductValuationFromBatches(params.productId)
    unitCostUsed = qty > 0 ? fifo.totalCost / qty : 0
    applied = {
      qty,
      unitCostUsed,
      totalCost: fifo.totalCost,
      averageCost: synced.averageCost,
      totalQty: synced.totalQty,
      totalValue: synced.totalValue,
    }
  } else {
    const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
    applied = applyDeliveryAverage({
      currentQty: valuation?.totalQty ?? 0,
      currentValue: Number(valuation?.totalValue ?? 0),
      averageCost: Number(valuation?.averageCost ?? 0),
      qty,
    })
    unitCostUsed = applied.unitCostUsed
    await prisma.productValuation.upsert({
      where: { productId: params.productId },
      create: {
        productId: params.productId,
        averageCost: applied.averageCost,
        totalQty: applied.totalQty,
        totalValue: applied.totalValue,
      },
      update: {
        averageCost: applied.averageCost,
        totalQty: applied.totalQty,
        totalValue: applied.totalValue,
      },
    })
  }

  if (params.movementId) {
    try {
      await prisma.stockMovement.update({
        where: { id: params.movementId },
        data: { unitCost: unitCostUsed },
      })
    } catch { /* ignore */ }
  }

  if (params.postJournal !== false && applied.totalCost > 0) {
    const { inventoryLabel, cogsLabel } = await resolveStockAccounts(params.productId)
    await createJournalEntry({
      ref: stockValuationJournalRef('delivery', params.reference || params.movementId || '', params.productId),
      journalCode: 'STK',
      description: `Stock delivery ${applied.qty} @ ${unitCostUsed}${costingMethod === 'fifo' ? ' FIFO' : ' avg'}`,
      sourceType: 'stock_delivery',
      sourceId: params.reference || params.movementId || params.productId,
      createdById: params.userId,
      skipIfExists: true,
      lines: [
        { accountLabel: cogsLabel, label: 'COGS', debit: applied.totalCost, credit: 0 },
        { accountLabel: inventoryLabel, label: 'Inventory reduction', debit: 0, credit: applied.totalCost },
      ],
    })
  }

  await markProcessed({
    eventKey,
    kind: 'delivery',
    productId: params.productId,
    qty: applied.qty,
    unitCost: unitCostUsed,
    reference: params.reference,
  })

  return {
    skipped: false as const,
    costingMethod,
    averageCost: applied.averageCost,
    unitCostUsed,
    totalCost: applied.totalCost,
    totalQty: applied.totalQty,
    totalValue: applied.totalValue,
  }
}
