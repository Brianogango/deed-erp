import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { loadAppState } from '@/lib/server-store'
import { mirrorSerialsToPrisma } from '@/lib/inventory/serial-mirror'
import { mirrorStockMovesToPrisma } from '@/lib/inventory/stock-move-mirror'
import { mirrorPurchaseOrdersToPrisma, mirrorReceiptsToPrisma } from '@/lib/inventory/purchase-mirror'
import { mirrorBulkStockToPrisma } from '@/lib/inventory/bulk-stock-mirror'
import { mirrorDeliveriesToPrisma } from '@/lib/inventory/delivery-mirror'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Idempotent inventory dual-write backfill. NEVER deletes app_state.
 * Order: serials → stock moves → POs → receipts → bulk stock → deliveries.
 */
export async function POST(request: NextRequest) {
  const internalSecret = process.env.INTERNAL_API_SECRET
  const providedSecret = request.headers.get('x-internal-secret')
  const secretOk = Boolean(internalSecret && providedSecret === internalSecret)

  if (!secretOk) {
    const session = await getServerSession()
    if (!session || session.user.role !== 'director') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const body = await request.json().catch(() => ({}))
  const force = !!body.force
  const sections: string[] = Array.isArray(body.sections)
    ? body.sections
    : ['serials', 'stockMoves', 'purchaseOrders', 'receipts', 'bulkStock', 'deliveries']

  const state = await loadAppState([
    'deed_serials',
    'deed_stockMoves',
    'deed_purchaseOrders',
    'deed_receipts',
    'deed_bulkStock',
    'deed_deliveries',
  ])

  const result: Record<string, unknown> = {
    blobCounts: {
      serials: Array.isArray(state.deed_serials) ? state.deed_serials.length : 0,
      stockMoves: Array.isArray(state.deed_stockMoves) ? state.deed_stockMoves.length : 0,
      purchaseOrders: Array.isArray(state.deed_purchaseOrders) ? state.deed_purchaseOrders.length : 0,
      receipts: Array.isArray(state.deed_receipts) ? state.deed_receipts.length : 0,
      bulkStock: Array.isArray(state.deed_bulkStock) ? state.deed_bulkStock.length : 0,
      deliveries: Array.isArray(state.deed_deliveries) ? state.deed_deliveries.length : 0,
    },
    note: 'app_state keys were not deleted',
  }

  if (sections.includes('serials')) {
    result.serials = await mirrorSerialsToPrisma(state.deed_serials ?? [], { force })
  }
  if (sections.includes('stockMoves')) {
    result.stockMoves = await mirrorStockMovesToPrisma(state.deed_stockMoves ?? [], { force })
  }
  if (sections.includes('purchaseOrders')) {
    result.purchaseOrders = await mirrorPurchaseOrdersToPrisma(state.deed_purchaseOrders ?? [], { force })
  }
  if (sections.includes('receipts')) {
    // Ensure POs exist first when receipts requested alone.
    if (!sections.includes('purchaseOrders')) {
      await mirrorPurchaseOrdersToPrisma(state.deed_purchaseOrders ?? [], { force })
    }
    result.receipts = await mirrorReceiptsToPrisma(state.deed_receipts ?? [], { force })
  }
  if (sections.includes('bulkStock')) {
    result.bulkStock = await mirrorBulkStockToPrisma(state.deed_bulkStock ?? [], { force })
  }
  if (sections.includes('deliveries')) {
    result.deliveries = await mirrorDeliveriesToPrisma(state.deed_deliveries ?? [], { force })
  }

  return NextResponse.json(result)
}
