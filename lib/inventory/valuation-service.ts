import 'server-only'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { COMPANY_ACCOUNT_FALLBACKS, formatAccountLabel } from '@/lib/product-accounts'
import {
  applyDeliveryAverage,
  applyReceiptAverage,
  stockValuationEventKey,
  stockValuationJournalRef,
} from '@/lib/inventory/valuation-math'

/**
 * Deed CoA does not have a dedicated GRNI code. Accruals (3201) is the closest
 * live liability bucket for "goods received, bill not yet posted".
 */
const GRNI_ACCOUNT_LABEL = '3201 - Accruals'

async function productExists(productId: string): Promise<boolean> {
  const row = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
  return Boolean(row)
}

async function alreadyProcessed(eventKey: string): Promise<boolean> {
  try {
    const row = await prisma.valuationEvent.findUnique({ where: { eventKey }, select: { id: true } })
    return Boolean(row)
  } catch {
    // Table may not exist yet before safe migration — fall back to journal ref
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
  // Account codes live on blob/catalog overlays today; company fallbacks match
  // product-accounts.ts until product account columns are mirrored to Prisma.
  return {
    inventoryLabel: formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.inventoryAccountCode, []),
    cogsLabel: formatAccountLabel(COMPANY_ACCOUNT_FALLBACKS.cogsAccountCode, []),
  }
}

/**
 * Weighted-average cost on stock receipt.
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
}) {
  if (!(await productExists(params.productId))) {
    return { skipped: true as const, reason: 'product_not_in_prisma' }
  }

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

  const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
  const applied = applyReceiptAverage({
    currentQty: valuation?.totalQty ?? 0,
    currentValue: Number(valuation?.totalValue ?? 0),
    qty: params.qty,
    unitCost: params.unitCost,
  })
  if (applied.qty <= 0) throw new Error('Receipt qty must be positive')

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
      description: `Stock receipt ${applied.qty} @ ${applied.unitCost}`,
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
    averageCost: applied.averageCost,
    totalQty: applied.totalQty,
    totalValue: applied.totalValue,
  }
}

/**
 * Delivery / outbound: reduce valuation at current average cost; post COGS.
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

  const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
  const applied = applyDeliveryAverage({
    currentQty: valuation?.totalQty ?? 0,
    currentValue: Number(valuation?.totalValue ?? 0),
    averageCost: Number(valuation?.averageCost ?? 0),
    qty: params.qty,
  })
  if (applied.qty <= 0) throw new Error('Delivery qty must be positive')

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

  if (params.movementId) {
    try {
      await prisma.stockMovement.update({
        where: { id: params.movementId },
        data: { unitCost: applied.unitCostUsed },
      })
    } catch { /* ignore */ }
  }

  if (params.postJournal !== false && applied.totalCost > 0) {
    const { inventoryLabel, cogsLabel } = await resolveStockAccounts(params.productId)
    await createJournalEntry({
      ref: stockValuationJournalRef('delivery', params.reference || params.movementId || '', params.productId),
      journalCode: 'STK',
      description: `Stock delivery ${applied.qty} @ avg ${applied.unitCostUsed}`,
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
    unitCost: applied.unitCostUsed,
    reference: params.reference,
  })

  return {
    skipped: false as const,
    averageCost: applied.averageCost,
    unitCostUsed: applied.unitCostUsed,
    totalCost: applied.totalCost,
    totalQty: applied.totalQty,
    totalValue: applied.totalValue,
  }
}
