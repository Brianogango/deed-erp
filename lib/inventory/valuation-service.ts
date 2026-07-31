import 'server-only'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/accounting/journal-service'
import { COMPANY_ACCOUNT_FALLBACKS } from '@/lib/product-accounts'

function round4(n: number) {
  return Math.round(Number(n || 0) * 10000) / 10000
}
function round2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100
}

/**
 * Weighted-average cost on stock receipt.
 * Dual-writes valuation + optional STK journal. Never touches app_state blobs.
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
  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  const unitCost = Math.max(0, Number(params.unitCost) || 0)
  if (qty <= 0) throw new Error('Receipt qty must be positive')

  const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
  const currentQty = valuation?.totalQty ?? 0
  const currentValue = Number(valuation?.totalValue ?? 0)
  const newQty = currentQty + qty
  const newValue = round2(currentValue + qty * unitCost)
  const newAvgCost = newQty > 0 ? round4(newValue / newQty) : 0

  await prisma.productValuation.upsert({
    where: { productId: params.productId },
    create: {
      productId: params.productId,
      averageCost: newAvgCost,
      totalQty: newQty,
      totalValue: newValue,
    },
    update: {
      averageCost: newAvgCost,
      totalQty: newQty,
      totalValue: newValue,
    },
  })

  if (params.movementId) {
    try {
      await prisma.stockMovement.update({
        where: { id: params.movementId },
        data: { unitCost },
      })
    } catch {
      // movement may live only in app_state — ignore
    }
  }

  if (params.postJournal !== false) {
    const totalCost = round2(qty * unitCost)
    if (totalCost > 0) {
      const inv = COMPANY_ACCOUNT_FALLBACKS.inventoryAccountCode
      const grni = '2300'
      await createJournalEntry({
        ref: `JRN/STK/RCV/${params.reference || params.movementId || params.productId}/${Date.now()}`.slice(0, 80),
        journalCode: 'STK',
        description: `Stock receipt ${qty} @ ${unitCost}`,
        sourceType: 'stock_move',
        sourceId: params.movementId || params.productId,
        createdById: params.userId,
        skipIfExists: true,
        lines: [
          { accountLabel: `${inv} - Inventory`, label: 'Inventory receipt', debit: totalCost, credit: 0 },
          { accountLabel: `${grni} - Goods Received Not Invoiced`, label: 'GRNI', debit: 0, credit: totalCost },
        ],
      })
    }
  }

  return { averageCost: newAvgCost, totalQty: newQty, totalValue: newValue }
}

/**
 * Delivery / outbound: reduce valuation at current average cost; post COGS.
 */
export async function processStockDelivery(params: {
  productId: string
  qty: number
  movementId?: string | null
  reference?: string
  userId?: string
  postJournal?: boolean
}) {
  const qty = Math.max(0, Math.floor(Number(params.qty) || 0))
  if (qty <= 0) throw new Error('Delivery qty must be positive')

  const valuation = await prisma.productValuation.findUnique({ where: { productId: params.productId } })
  const avgCost = Number(valuation?.averageCost ?? 0)
  const totalCost = round2(qty * avgCost)
  const currentQty = valuation?.totalQty ?? 0
  const currentValue = Number(valuation?.totalValue ?? 0)
  const newQty = Math.max(0, currentQty - qty)
  const newValue = Math.max(0, round2(currentValue - totalCost))
  const newAvg = newQty > 0 ? round4(newValue / newQty) : 0

  await prisma.productValuation.upsert({
    where: { productId: params.productId },
    create: {
      productId: params.productId,
      averageCost: newAvg,
      totalQty: newQty,
      totalValue: newValue,
    },
    update: {
      averageCost: newAvg,
      totalQty: newQty,
      totalValue: newValue,
    },
  })

  if (params.movementId) {
    try {
      await prisma.stockMovement.update({
        where: { id: params.movementId },
        data: { unitCost: avgCost },
      })
    } catch { /* ignore */ }
  }

  if (params.postJournal !== false && totalCost > 0) {
    const cogs = COMPANY_ACCOUNT_FALLBACKS.cogsAccountCode
    const inv = COMPANY_ACCOUNT_FALLBACKS.inventoryAccountCode
    await createJournalEntry({
      ref: `JRN/STK/DEL/${params.reference || params.movementId || params.productId}/${Date.now()}`.slice(0, 80),
      journalCode: 'STK',
      description: `Stock delivery ${qty} @ avg ${avgCost}`,
      sourceType: 'stock_move',
      sourceId: params.movementId || params.productId,
      createdById: params.userId,
      skipIfExists: true,
      lines: [
        { accountLabel: `${cogs} - Cost of Goods Sold`, label: 'COGS', debit: totalCost, credit: 0 },
        { accountLabel: `${inv} - Inventory`, label: 'Inventory reduction', debit: 0, credit: totalCost },
      ],
    })
  }

  return { averageCost: newAvg, unitCostUsed: avgCost, totalCost, totalQty: newQty, totalValue: newValue }
}
