import { NextRequest, NextResponse } from 'next/server'
import { getRequiredSession, withApiErrorHandling } from '@/lib/auth/api'
import { canWriteStoreKey } from '@/lib/auth/store-write-policy'
import { loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { allocateAssetIds } from '@/lib/inventory/asset-id.server'
import { normalizeAssetId } from '@/lib/inventory/asset-id'

export const dynamic = 'force-dynamic'

type Row = Record<string, any>

/**
 * POST { serialIds } — machines about to get a label: any without an asset
 * ID get one now (LT000124…, counted per category) and it becomes their
 * barcode. Machines that already have one keep it. Returns id → asset ID.
 */
export async function POST(request: NextRequest) {
  return withApiErrorHandling(async () => {
    const session = await getRequiredSession()
    if (!canWriteStoreKey(session.user, 'deed_serials')) return NextResponse.json({ error: 'You cannot label stock' }, { status: 403 })
    const body = await request.json().catch(() => ({})) as { serialIds?: unknown }
    const wanted = new Set((Array.isArray(body.serialIds) ? body.serialIds : []).map(String).slice(0, 500))
    if (!wanted.size) return NextResponse.json({ assetIds: {} })

    return withAppStateKeyLock('deed_serials', async () => {
      const state = await loadAppStateForWrite(['deed_serials', 'deed_products'])
      const serials = [...((state.deed_serials as Row[]) ?? [])]
      const products = (state.deed_products as Row[]) ?? []
      const categoryOf = new Map(products.map(p => [String(p.id), String(p.category ?? '')]))
      const out: Record<string, string> = {}
      const missing = new Map<string, number[]>()
      serials.forEach((s, i) => {
        if (!wanted.has(String(s.id))) return
        const has = normalizeAssetId(s.assetId)
        if (has) { out[String(s.id)] = has; return }
        const cat = categoryOf.get(String(s.productId)) ?? ''
        missing.set(cat, [...(missing.get(cat) ?? []), i])
      })
      if (!missing.size) return NextResponse.json({ assetIds: out })
      for (const [cat, idx] of missing) {
        const ids = await allocateAssetIds(cat, idx.length, serials)
        idx.forEach((i, k) => {
          serials[i] = { ...serials[i], assetId: ids[k], barcode: ids[k] }
          out[String(serials[i].id)] = ids[k]
        })
      }
      await saveStoreKeys({ deed_serials: JSON.stringify(serials) })
      return NextResponse.json({ assetIds: out, assigned: [...missing.values()].reduce((s, a) => s + a.length, 0) })
    })
  })
}
