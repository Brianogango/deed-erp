import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import prisma from '@/lib/prisma'
import { loadAppState } from '@/lib/server-store'

export const dynamic = 'force-dynamic'

/**
 * Compare blob on-hand qty vs Prisma ProductValuation for Finance/Inventory.
 */
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = String(session.user.role)
  if (!['director', 'finance_officer', 'admin_officer', 'inventory_officer'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const state = await loadAppState(['deed_products'])
  const products = Array.isArray(state.deed_products) ? state.deed_products as any[] : []
  const valuations = await prisma.productValuation.findMany().catch(() => [])
  const byId = new Map(valuations.map(v => [v.productId, v]))

  const rows = products
    .filter(p => p && !p.archived && p.unit !== 'service')
    .map(p => {
      const v = byId.get(p.id)
      const onHand = Math.max(0, Math.floor(Number(p.stockQty) || 0))
      const valQty = v?.totalQty ?? 0
      const averageCost = Number(v?.averageCost ?? 0)
      const totalValue = Number(v?.totalValue ?? 0)
      const listCost = Math.max(0, Number(p.costPrice) || 0)
      // What restocking would cost today: on hand × latest purchase cost
      // (the average where the product has no receipt yet). Not the books.
      const latestCost = Math.max(0, Number(p.latestCost) || 0)
      const replacementUnit = latestCost > 0 ? latestCost : (averageCost || listCost)
      return {
        productId: p.id,
        sku: p.sku || '',
        name: p.name || '',
        onHand,
        valuationQty: valQty,
        qtyDrift: onHand - valQty,
        averageCost,
        totalValue,
        listCost,
        impliedListValue: Math.round(onHand * listCost * 100) / 100,
        latestCost,
        latestCostDate: String(p.latestCostDate || ''),
        latestCostRef: String(p.latestCostRef || ''),
        replacementValue: Math.round(onHand * replacementUnit * 100) / 100,
      }
    })
    .filter(r => r.onHand > 0 || r.valuationQty > 0 || r.totalValue > 0)
    .sort((a, b) => b.totalValue - a.totalValue || b.onHand - a.onHand)

  const totals = rows.reduce(
    (acc, r) => {
      acc.onHand += r.onHand
      acc.valuationQty += r.valuationQty
      acc.totalValue += r.totalValue
      acc.impliedListValue += r.impliedListValue
      acc.replacementValue += r.replacementValue
      acc.driftLines += Math.abs(r.qtyDrift) > 0 ? 1 : 0
      return acc
    },
    { onHand: 0, valuationQty: 0, totalValue: 0, impliedListValue: 0, replacementValue: 0, driftLines: 0 },
  )

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totals: {
      ...totals,
      totalValue: Math.round(totals.totalValue * 100) / 100,
      impliedListValue: Math.round(totals.impliedListValue * 100) / 100,
      replacementValue: Math.round(totals.replacementValue * 100) / 100,
    },
    rows,
  })
}
