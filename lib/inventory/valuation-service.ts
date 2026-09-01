import 'server-only'
import prisma from '@/lib/prisma'
import { postStockJournal, reversePosting } from '@/lib/accounting/posting-service'
import { labelForRole } from '@/lib/accounting/coa-roles'
import { loadAppState } from '@/lib/server-store'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'
import { GRNI_ACCOUNT_LABEL } from '@/lib/accounting/vendor-bill-perpetual'
import {
  applyDeliveryAverage,
  applyReceiptAverage,
  consumeBatchesFIFO,
  restoreBatchesFIFO,
  stockValuationEventKey,
  stockValuationJournalRef,
  type StockValuationKind,
} from '@/lib/inventory/valuation-math'
import { isNonStockProduct } from '@/lib/sales/non-stock-line'

const DEFAULT_WAREHOUSE_ID = 'main'
const PRICE_DIFF_LABEL = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.priceDifferenceAccountCode, [])
const WRITE_OFF_LABEL = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.writeOffAccountCode, [])
const ADJUSTMENT_LABEL = formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.adjustmentAccountCode, [])
/** Opening stock/balances offset equity — never the P&L adjustment account. */
const OPENING_EQUITY_LABEL = '4004 - Opening Balance Equity'
/** Repair parts consumption posts to direct repair costs, not generic COGS. */
const REPAIR_COST_LABEL = '6301 - Solutions and Expert Repair Services\' Costs'

async function persistStockJournal(params: {
  ref: string
  description: string
  sourceType: string
  sourceId?: string | null
  lines: Array<{ accountLabel: string; label: string; debit: number; credit: number }>
  createdById?: string | null
  ledger?: {
    productId: string
    quantity: number
    unitCost: number
    movementType: string
    value: number
  }
}) {
  const journal = await postStockJournal({
    ref: params.ref,
    description: params.description,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    createdById: params.createdById,
    lines: params.lines.map(l => ({
      accountLabel: l.accountLabel,
      description: l.label,
      debit: l.debit,
      credit: l.credit,
    })),
  })
  if (params.ledger && journal?.id) {
    const eventKey = `ledger:${params.sourceType}:${params.sourceId || params.ref}:${params.ledger.productId}`.slice(0, 160)
    try {
      await prisma.inventoryLedgerEntry.upsert({
        where: { eventKey },
        create: {
          eventKey,
          productId: params.ledger.productId,
          location: 'warehouse',
          movementType: params.ledger.movementType,
          quantity: params.ledger.quantity,
          unitCost: params.ledger.unitCost,
          value: params.ledger.value,
          documentDate: new Date(),
          sourceType: params.sourceType.slice(0, 40),
          sourceId: String(params.sourceId || params.ref).slice(0, 120),
          journalEntryId: journal.id,
        },
        update: { journalEntryId: journal.id },
      })
    } catch (err) {
      // Journal already posted. A missing/locked ledger table must not roll back POS.
      console.error(
        `Inventory ledger write failed for ${eventKey}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
  return journal
}

export type CostingMethod = 'average' | 'fifo' | 'standard'

async function productExists(productId: string): Promise<boolean> {
  const row = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  return Boolean(row)
}

async function isPrismaNonStockProduct(productId: string): Promise<boolean> {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      trackStock: true,
      trackingMethod: true,
      invoicePolicy: true,
      specs: true,
      category: { select: { name: true } },
    },
  })
  if (!row) return false
  return isNonStockProduct({
    trackStock: row.trackStock,
    trackingMethod: row.trackingMethod,
    invoicePolicy: row.invoicePolicy,
    specs: row.specs,
    category: row.category?.name,
  })
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
    inventoryLabel: labelForRole('inventory'),
    cogsLabel: labelForRole('cogs'),
  }
}

async function resolveStandardCost(productId: string): Promise<number | null> {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { costPrice: true },
    })
    if (product?.costPrice == null) return null
    return Math.max(0, Number(product.costPrice) || 0)
  } catch {
    return null
  }
}

async function applyOutboundValuation(params: {
  productId: string
  qty: number
  kind: StockValuationKind
  reference?: string
  movementId?: string | null
  userId?: string
  postJournal?: boolean
  /** Journal lines override (default COGS / Inventory for delivery). */
  journalLines?: (totalCost: number, unitCost: number) => Array<{
    accountLabel: string
    label: string
    debit: number
    credit: number
  }>
  journalDescription?: string
}) {
  if (!(await productExists(params.productId))) {
    return { skipped: true as const, reason: 'product_not_in_prisma' }
  }
  if (await isPrismaNonStockProduct(params.productId)) {
    return { skipped: true as const, reason: 'non_stock' }
  }

  const costingMethod = await resolveCostingMethod(params.productId)
  const eventKey = stockValuationEventKey(params.kind, params.reference || params.movementId || '', params.productId)
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
  if (qty <= 0) throw new Error('Outbound qty must be positive')

  let applied: ReturnType<typeof applyDeliveryAverage>
  let unitCostUsed = 0

  if (costingMethod === 'fifo') {
    const toLayers = (rows: Array<{ id: string; quantityAvailable: number; unitCost: unknown; receivedAt: Date }>) =>
      rows.map(b => ({
        id: b.id,
        quantityAvailable: b.quantityAvailable,
        unitCost: Number(b.unitCost ?? 0),
        receivedAt: b.receivedAt,
      }))
    const loadBatches = () => prisma.inventoryBatch.findMany({
      where: { productId: params.productId, quantityAvailable: { gt: 0 } },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    })
    let batches = await loadBatches()
    let fifo = consumeBatchesFIFO(toLayers(batches), qty)
    if (fifo.shortfall > 0) {
      // Legacy stock (pre-batch receipts, serial-tracked units, opening stock)
      // has no FIFO layers. Cover the shortfall at standard cost — the same
      // fallback POS already used — instead of blocking the operational
      // document (delivery validation, and with it invoicing, for sale
      // orders). Only a failed cover write remains a hard error.
      const fallbackCost = (await resolveStandardCost(params.productId)) ?? 0
      try {
        await upsertFifoBatch({
          productId: params.productId,
          qty: fifo.shortfall,
          unitCost: fallbackCost,
          reference: `AUTO-${params.reference || params.kind}`.slice(0, 80),
        })
      } catch (err) {
        throw new Error(
          `FIFO auto-cover failed for product ${params.productId}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      batches = await loadBatches()
      fifo = consumeBatchesFIFO(toLayers(batches), qty)
    }
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
  } else if (costingMethod === 'standard') {
    const standard = (await resolveStandardCost(params.productId)) ?? 0
    const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
    applied = applyDeliveryAverage({
      currentQty: valuation?.totalQty ?? 0,
      currentValue: Number(valuation?.totalValue ?? 0),
      averageCost: standard > 0 ? standard : Number(valuation?.averageCost ?? 0),
      qty,
    })
    unitCostUsed = applied.unitCostUsed
    await prisma.productValuation.upsert({
      where: { productId: params.productId },
      create: {
        productId: params.productId,
        averageCost: unitCostUsed,
        totalQty: applied.totalQty,
        totalValue: applied.totalValue,
      },
      update: {
        averageCost: unitCostUsed,
        totalQty: applied.totalQty,
        totalValue: applied.totalValue,
      },
    })
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
    const lines = params.journalLines
      ? params.journalLines(applied.totalCost, unitCostUsed)
      : [
          { accountLabel: cogsLabel, label: 'COGS', debit: applied.totalCost, credit: 0 },
          { accountLabel: inventoryLabel, label: 'Inventory reduction', debit: 0, credit: applied.totalCost },
        ]
    await persistStockJournal({
      ref: stockValuationJournalRef(params.kind, params.reference || params.movementId || '', params.productId),
      description: params.journalDescription
        || `Stock ${params.kind} ${applied.qty} @ ${unitCostUsed}${costingMethod === 'fifo' ? ' FIFO' : costingMethod === 'standard' ? ' std' : ' avg'}`,
      sourceType: `stock_${params.kind}`,
      sourceId: params.reference || params.movementId || params.productId,
      createdById: params.userId,
      lines,
      ledger: {
        productId: params.productId,
        quantity: -applied.qty,
        unitCost: unitCostUsed,
        movementType: params.kind,
        value: -applied.totalCost,
      },
    })
  }

  await markProcessed({
    eventKey,
    kind: params.kind,
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
  const receiptCost = Math.max(0, Number(params.unitCost) || 0)
  if (qty <= 0) throw new Error('Receipt qty must be positive')

  // Standard costing values inventory at product.costPrice; PO/receipt cost
  // vs standard posts to price difference immediately (GRNI still at receipt cost).
  const standardCost = costingMethod === 'standard'
    ? ((await resolveStandardCost(params.productId)) ?? receiptCost)
    : receiptCost
  const unitCost = costingMethod === 'standard' ? standardCost : receiptCost

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

  if (params.postJournal !== false && (applied.totalCost > 0 || receiptCost * qty > 0)) {
    const { inventoryLabel } = await resolveStockAccounts(params.productId)
    const invDebit = applied.totalCost
    const grniCredit = Math.round(receiptCost * qty * 100) / 100
    const variance = Math.round((grniCredit - invDebit) * 100) / 100
    const lines = [
      { accountLabel: inventoryLabel, label: 'Inventory receipt', debit: invDebit, credit: 0 },
      ...(variance > 0
        ? [{ accountLabel: PRICE_DIFF_LABEL, label: 'Purchase price variance', debit: variance, credit: 0 }]
        : variance < 0
          ? [{ accountLabel: PRICE_DIFF_LABEL, label: 'Purchase price variance', debit: 0, credit: -variance }]
          : []),
      { accountLabel: GRNI_ACCOUNT_LABEL, label: 'GRNI / Accruals', debit: 0, credit: grniCredit || invDebit },
    ]
    await persistStockJournal({
      ref: stockValuationJournalRef('receipt', params.reference || params.movementId || '', params.productId),
      description: `Stock receipt ${applied.qty} @ ${applied.unitCost}${costingMethod === 'fifo' ? ' (FIFO)' : costingMethod === 'standard' ? ' (std)' : ''}`,
      sourceType: 'stock_receipt',
      sourceId: params.reference || params.movementId || params.productId,
      createdById: params.userId,
      lines,
      ledger: {
        productId: params.productId,
        quantity: applied.qty,
        unitCost: applied.unitCost,
        movementType: 'receipt',
        value: invDebit,
      },
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

  // Keep product master cost (and margin-policy list) aligned with new average.
  try {
    const { syncProductListFromCost } = await import('@/lib/pricing/sync-product-list-from-cost.server')
    await syncProductListFromCost({
      productId: params.productId,
      costPrice: applied.averageCost,
      recalcSale: true,
    })
  } catch {
    /* non-fatal — valuation already committed */
  }

  return {
    skipped: false as const,
    costingMethod,
    averageCost: applied.averageCost,
    totalQty: applied.totalQty,
    totalValue: applied.totalValue,
  }
}

/**
 * Delivery / outbound: reduce valuation at average, FIFO, or standard cost; post COGS.
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
  return applyOutboundValuation({
    productId: params.productId,
    qty: params.qty,
    kind: 'delivery',
    reference: params.reference,
    movementId: params.movementId,
    userId: params.userId,
    postJournal: params.postJournal,
  })
}

/** POS sale — same COGS math as delivery, separate idempotency key. */
export async function processStockPosSale(params: {
  productId: string
  qty: number
  reference?: string
  userId?: string
  postJournal?: boolean
}) {
  return applyOutboundValuation({
    productId: params.productId,
    qty: params.qty,
    kind: 'pos',
    reference: params.reference,
    userId: params.userId,
    postJournal: params.postJournal,
    journalDescription: `POS sale ${params.qty}`,
  })
}

/**
 * Repair parts consumption (QC pass) — Dr 6301 Solutions & Repair Services'
 * Costs / Cr 1200 Inventory at the moving-average cost. Idempotent per
 * (repair ref, productId).
 */
export async function processStockRepairConsume(params: {
  productId: string
  qty: number
  reference?: string
  userId?: string
  postJournal?: boolean
}) {
  return applyOutboundValuation({
    productId: params.productId,
    qty: params.qty,
    kind: 'repair',
    reference: params.reference,
    userId: params.userId,
    postJournal: params.postJournal,
    journalDescription: `Repair parts consumption ${params.reference ?? ''}`.trim(),
    journalLines: (totalCost) => [
      { accountLabel: REPAIR_COST_LABEL, label: 'Repair parts cost', debit: totalCost, credit: 0 },
      { accountLabel: formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.inventoryAccountCode, []), label: 'Inventory reduction', debit: 0, credit: totalCost },
    ],
  })
}

async function restoreFifoQty(params: {
  productId: string
  qty: number
  unitCost: number
  reference: string
}) {
  const batches = await prisma.inventoryBatch.findMany({
    where: { productId: params.productId },
    orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
  })
  const restored = restoreBatchesFIFO(
    batches.map(b => ({
      id: b.id,
      quantityAvailable: b.quantityAvailable,
      quantityReceived: b.quantityReceived,
      unitCost: Number(b.unitCost ?? 0),
      receivedAt: b.receivedAt,
    })),
    params.qty,
  )
  for (const line of restored.restored) {
    await prisma.inventoryBatch.update({
      where: { id: line.batchId },
      data: { quantityAvailable: { increment: line.qty } },
    })
  }
  if (restored.leftover > 0) {
    await upsertFifoBatch({
      productId: params.productId,
      qty: restored.leftover,
      unitCost: params.unitCost,
      reference: `POS-REV-${params.reference}`.slice(0, 80),
    })
  }
}

/**
 * Undo a POS valuation that already posted (FIFO consume + COGS) after the
 * checkout itself failed. Idempotent when the VAL/POS event is gone.
 */
export async function reversePosSaleValuation(params: {
  productId: string
  qty?: number
  reference?: string
  userId?: string
}) {
  const reference = String(params.reference || '').trim()
  const eventKey = stockValuationEventKey('pos', reference, params.productId)
  const event = await prisma.valuationEvent.findUnique({ where: { eventKey } }).catch(() => null)
  if (!event) {
    return { skipped: true as const, reason: 'not_processed' }
  }

  const qty = Math.max(0, Math.floor(Number(event.qty) || Number(params.qty) || 0))
  const unitCost = Math.max(0, Number(event.unitCost ?? 0))
  const costingMethod = await resolveCostingMethod(params.productId)

  if (qty > 0) {
    if (costingMethod === 'fifo') {
      await restoreFifoQty({
        productId: params.productId,
        qty,
        unitCost,
        reference: reference || 'noref',
      })
      await syncProductValuationFromBatches(params.productId)
    } else {
      const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
      const applied = applyReceiptAverage({
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
  }

  const journalRef = stockValuationJournalRef('pos', reference, params.productId)
  try {
    await reversePosting(journalRef, params.userId)
  } catch {
    /* journal may be missing when valuation threw before posting */
  }

  const ledgerKey = `ledger:stock_pos:${reference}:${params.productId}`.slice(0, 160)
  await prisma.inventoryLedgerEntry.deleteMany({ where: { eventKey: ledgerKey } }).catch(() => {})
  await prisma.valuationEvent.deleteMany({ where: { eventKey } }).catch(() => {})

  return { skipped: false as const, qty, unitCost }
}

/**
 * Customer RMA receive — reverse delivery COGS (Dr Inventory / Cr COGS).
 */
export async function processStockCustomerReturn(params: {
  productId: string
  qty: number
  reference?: string
  userId?: string
  postJournal?: boolean
  unitCost?: number
}) {
  if (!(await productExists(params.productId))) {
    return { skipped: true as const, reason: 'product_not_in_prisma' }
  }
  const costingMethod = await resolveCostingMethod(params.productId)
  const eventKey = stockValuationEventKey('customer_return', params.reference || '', params.productId)
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
  if (qty <= 0) throw new Error('Return qty must be positive')

  const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
  const unitCost = Math.max(
    0,
    Number(params.unitCost)
      || (costingMethod === 'standard' ? ((await resolveStandardCost(params.productId)) ?? 0) : 0)
      || Number(valuation?.averageCost ?? 0),
  )

  let applied: ReturnType<typeof applyReceiptAverage>
  if (costingMethod === 'fifo') {
    await upsertFifoBatch({
      productId: params.productId,
      qty,
      unitCost,
      reference: String(params.reference || 'crtn'),
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

  if (params.postJournal !== false && applied.totalCost > 0) {
    const { inventoryLabel, cogsLabel } = await resolveStockAccounts(params.productId)
    await persistStockJournal({
      ref: stockValuationJournalRef('customer_return', params.reference || '', params.productId),
      description: `Customer return ${applied.qty} @ ${unitCost}`,
      sourceType: 'stock_customer_return',
      sourceId: params.reference || params.productId,
      createdById: params.userId,
      lines: [
        { accountLabel: inventoryLabel, label: 'Inventory restore', debit: applied.totalCost, credit: 0 },
        { accountLabel: cogsLabel, label: 'COGS reversal', debit: 0, credit: applied.totalCost },
      ],
      ledger: {
        productId: params.productId,
        quantity: applied.qty,
        unitCost,
        movementType: 'customer_return',
        value: applied.totalCost,
      },
    })
  }

  await markProcessed({
    eventKey,
    kind: 'customer_return',
    productId: params.productId,
    qty: applied.qty,
    unitCost,
    reference: params.reference,
  })

  return {
    skipped: false as const,
    costingMethod,
    averageCost: applied.averageCost,
    unitCostUsed: unitCost,
    totalCost: applied.totalCost,
    totalQty: applied.totalQty,
    totalValue: applied.totalValue,
  }
}

/**
 * Vendor RTV — remove inventory asset and restore GRNI (Dr GRNI / Cr Inventory).
 * Pair with perpetual vendor credit note (Dr AP / Cr GRNI).
 */
export async function processStockVendorReturn(params: {
  productId: string
  qty: number
  reference?: string
  userId?: string
  postJournal?: boolean
}) {
  const { inventoryLabel } = await resolveStockAccounts(params.productId)
  return applyOutboundValuation({
    productId: params.productId,
    qty: params.qty,
    kind: 'vendor_return',
    reference: params.reference,
    userId: params.userId,
    postJournal: params.postJournal,
    journalDescription: `Vendor return ${params.qty}`,
    journalLines: (totalCost) => [
      { accountLabel: GRNI_ACCOUNT_LABEL, label: 'GRNI on vendor return', debit: totalCost, credit: 0 },
      { accountLabel: inventoryLabel, label: 'Inventory reduction', debit: 0, credit: totalCost },
    ],
  })
}

/** Stock adjustment add/subtract — updates valuation and posts STK journal. */
export async function processStockAdjustment(params: {
  productId: string
  qty: number
  type: 'add' | 'subtract'
  reference?: string
  userId?: string
  postJournal?: boolean
  unitCost?: number
}) {
  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  if (qty <= 0) throw new Error('Adjustment qty must be positive')

  if (params.type === 'subtract') {
    const { inventoryLabel } = await resolveStockAccounts(params.productId)
    return applyOutboundValuation({
      productId: params.productId,
      qty,
      kind: 'adjustment_sub',
      reference: params.reference,
      userId: params.userId,
      postJournal: params.postJournal,
      journalDescription: `Stock write-off ${qty}`,
      journalLines: (totalCost) => [
        { accountLabel: WRITE_OFF_LABEL, label: 'Stock write-off', debit: totalCost, credit: 0 },
        { accountLabel: inventoryLabel, label: 'Inventory reduction', debit: 0, credit: totalCost },
      ],
    })
  }

  // add
  if (!(await productExists(params.productId))) {
    return { skipped: true as const, reason: 'product_not_in_prisma' }
  }
  const costingMethod = await resolveCostingMethod(params.productId)
  const eventKey = stockValuationEventKey('adjustment_add', params.reference || '', params.productId)
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

  const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
  const unitCost = Math.max(
    0,
    Number(params.unitCost)
      || (costingMethod === 'standard' ? ((await resolveStandardCost(params.productId)) ?? 0) : 0)
      || Number(valuation?.averageCost ?? 0),
  )

  let applied: ReturnType<typeof applyReceiptAverage>
  if (costingMethod === 'fifo') {
    await upsertFifoBatch({
      productId: params.productId,
      qty,
      unitCost,
      reference: String(params.reference || 'adj'),
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

  if (params.postJournal !== false && applied.totalCost > 0) {
    const { inventoryLabel } = await resolveStockAccounts(params.productId)
    await persistStockJournal({
      ref: stockValuationJournalRef('adjustment_add', params.reference || '', params.productId),
      description: `Stock gain ${applied.qty} @ ${unitCost}`,
      sourceType: 'stock_adjustment',
      sourceId: params.reference || params.productId,
      createdById: params.userId,
      lines: [
        { accountLabel: inventoryLabel, label: 'Inventory gain', debit: applied.totalCost, credit: 0 },
        { accountLabel: ADJUSTMENT_LABEL, label: 'Inventory variance', debit: 0, credit: applied.totalCost },
      ],
      ledger: {
        productId: params.productId,
        quantity: applied.qty,
        unitCost,
        movementType: 'adjustment',
        value: applied.totalCost,
      },
    })
  }

  await markProcessed({
    eventKey,
    kind: 'adjustment_add',
    productId: params.productId,
    qty: applied.qty,
    unitCost,
    reference: params.reference,
  })

  return {
    skipped: false as const,
    costingMethod,
    averageCost: applied.averageCost,
    unitCostUsed: unitCost,
    totalCost: applied.totalCost,
    totalQty: applied.totalQty,
    totalValue: applied.totalValue,
  }
}

/** Seed valuation for opening stock (Dr Inventory / Cr Opening equity or variance). */
export async function processOpeningStockValuation(params: {
  productId: string
  qty: number
  unitCost: number
  reference?: string
  userId?: string
  postJournal?: boolean
}) {
  return processStockReceipt({
    productId: params.productId,
    qty: params.qty,
    unitCost: params.unitCost,
    reference: params.reference || 'OPENING',
    userId: params.userId,
    postJournal: false, // opening uses a dedicated journal below when enabled
  }).then(async (result) => {
    if (result.skipped || params.postJournal === false) return result
    const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
    const unitCost = Math.max(0, Number(params.unitCost) || 0)
    const total = Math.round(qty * unitCost * 100) / 100
    if (total <= 0) return result
    const { inventoryLabel } = await resolveStockAccounts(params.productId)
    const eventKey = stockValuationEventKey('opening', params.reference || 'OPENING', params.productId)
    // Receipt mark already used VAL/RCV — also mark opening journal separately via skipIfExists
    await persistStockJournal({
      ref: stockValuationJournalRef('opening', params.reference || 'OPENING', params.productId),
      description: `Opening stock ${qty} @ ${unitCost}`,
      sourceType: 'stock_opening',
      sourceId: params.reference || 'OPENING',
      createdById: params.userId,
      lines: [
        { accountLabel: inventoryLabel, label: 'Opening inventory', debit: total, credit: 0 },
        { accountLabel: OPENING_EQUITY_LABEL, label: 'Opening balance equity', debit: 0, credit: total },
      ],
      ledger: {
        productId: params.productId,
        quantity: qty,
        unitCost,
        movementType: 'opening',
        value: total,
      },
    })
    try {
      await markProcessed({
        eventKey,
        kind: 'opening',
        productId: params.productId,
        qty,
        unitCost,
        reference: params.reference || 'OPENING',
      })
    } catch { /* ignore */ }
    return result
  })
}
