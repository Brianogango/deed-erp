import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { loadAppState } from '@/lib/server-store'
import { buyBackStockCosts, resolveBuyBackProduct } from '@/lib/buyback-credit'
import { postTradeInStockValuation } from '@/lib/inventory/valuation-hooks'

export const dynamic = 'force-dynamic'

type BuyBackRow = { id: string; ref: string; status?: string; lines?: Array<{ productId: string; productName: string; qty: number; unitPrice: number }> }

/**
 * POST { buyBackId } — a stocked buy-back's machines take their trade-in cost
 * into inventory (Dr Inventory, Cr Trade-in Purchases 6114). Costs come from
 * the buy-back as saved, never from the request. Safe to repeat.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!canWriteStoreKey(session.user, 'deed_buyBacks')) {
      return NextResponse.json({ error: 'Forbidden — you may not stock buy-backs' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({})) as { buyBackId?: unknown }
    const id = String(body.buyBackId ?? '').trim()
    if (!id) return NextResponse.json({ error: 'buyBackId is required' }, { status: 422 })
    const state = await loadAppState(['deed_buyBacks', 'deed_products'])
    const bb = ((state.deed_buyBacks as BuyBackRow[]) ?? []).find(b => b.id === id)
    if (!bb) return NextResponse.json({ error: 'Buy-back not found' }, { status: 404 })
    // The browser's "stocked" save may land a moment after this call; a paid
    // (or credited) buy-back is enough — that is what put the cost in 6114.
    if (!['paid', 'stocked'].includes(String(bb.status))) {
      return NextResponse.json({ error: 'Settle the buy-back (pay or add as credit) before stocking it' }, { status: 409 })
    }
    const products = (state.deed_products as Array<{ id: string; name?: string; isActive?: boolean; mergedIntoId?: string }>) ?? []
    // The same product the screen stocked the machine into (relinked by name
    // when the line's product id is gone).
    const resolved = (bb.lines ?? []).flatMap(l => {
      const product = resolveBuyBackProduct(l, products)
      return product ? [{ ...l, productId: product.id }] : []
    })
    const lines = buyBackStockCosts(resolved)
    const result = await postTradeInStockValuation({ buyBackRef: bb.ref, lines, userId: session.user.id })
    return NextResponse.json(result)
  })
}
