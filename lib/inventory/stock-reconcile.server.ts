import 'server-only'

import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { upsertBulkStock, type BulkStockLevel } from '@/lib/business-logic'
import { appendInventoryAuditLog } from '@/lib/inventory/audit'
import { planQuantityReconcile, type ReconcileRow } from '@/lib/inventory/stock-reconcile'

async function currentPlan() {
  const state = await loadAppState(['deed_products', 'deed_bulkStock', 'deed_serials'])
  const levels = await prisma.stockLevel.findMany({ select: { productId: true, qtyOnHand: true } })
  const plan = planQuantityReconcile({
    products: Array.isArray(state.deed_products) ? state.deed_products as any[] : [],
    bulkStock: Array.isArray(state.deed_bulkStock) ? state.deed_bulkStock as any[] : [],
    serials: Array.isArray(state.deed_serials) ? state.deed_serials as any[] : [],
    tableQty: new Map(levels.map(l => [l.productId, l.qtyOnHand])),
  })
  return { state, plan }
}

export async function previewQuantityReconcile(): Promise<ReconcileRow[]> {
  return (await currentPlan()).plan
}

/**
 * Bring both sides down to the lower number. Copy reductions are recorded as
 * stock moves (type 'adjustment') and every product in the audit log. No
 * ledger entry is made: the value at cost is reported for the accountant.
 */
export async function applyQuantityReconcile(user: { id: string; username?: string | null }) {
  return withAppStateKeyLock('deed_bulkStock', async () => {
    const { state, plan } = await currentPlan()
    if (!plan.length) return { rows: [], valueAtCost: 0 }
    const ref = `RECON/${new Date().toISOString().slice(0, 10)}`
    let bulkStock = (Array.isArray(state.deed_bulkStock) ? [...state.deed_bulkStock] : []) as BulkStockLevel[]
    const products = (Array.isArray(state.deed_products) ? [...state.deed_products] : []) as any[]
    const moves: any[] = []
    const now = new Date().toISOString()

    for (const row of plan) {
      for (const cut of row.copyCuts) {
        bulkStock = upsertBulkStock(bulkStock, row.productId, cut.location as any, -cut.qty)
        moves.push({
          id: randomUUID(), type: 'adjustment', productId: row.productId, productName: row.product, qty: cut.qty,
          reason: `${ref}: stock reconciliation — screen ${row.copyQty}, database ${row.tableQty}, set to the lower (${row.target})`,
          fromLocation: cut.location, serialNumbers: [], date: now, userId: user.id, documentRef: ref,
        })
      }
      const copyCut = row.copyQty - row.target
      if (copyCut > 0) {
        const i = products.findIndex(p => p?.id === row.productId)
        if (i >= 0) products[i] = { ...products[i], stockQty: Math.max(0, Number(products[i].stockQty ?? 0) - copyCut) }
      }
      if (row.tableCut > 0) {
        await prisma.stockLevel.update({ where: { productId: row.productId }, data: { qtyOnHand: row.target } })
      }
    }

    if (moves.length) {
      const stockMoves = await loadAppState(['deed_stockMoves'])
      const existing = Array.isArray(stockMoves.deed_stockMoves) ? stockMoves.deed_stockMoves as any[] : []
      await saveStoreKeys({
        deed_bulkStock: JSON.stringify(bulkStock),
        deed_products: JSON.stringify(products),
        deed_stockMoves: JSON.stringify([...moves, ...existing]),
      })
    }
    for (const row of plan) {
      await appendInventoryAuditLog({
        action: 'stock_reconciliation',
        documentRef: ref,
        details: `${row.product}: screen ${row.copyQty}, database ${row.tableQty} → ${row.target}`,
        userId: user.id,
        username: user.username ?? null,
      }).catch(() => undefined)
    }
    const valueAtCost = plan.reduce((s, r) => s + (Math.max(r.copyQty, r.tableQty) - r.target) * r.unitCost, 0)
    return { rows: plan, valueAtCost, ref }
  })
}
