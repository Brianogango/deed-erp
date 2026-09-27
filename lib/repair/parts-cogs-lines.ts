/**
 * Which repair-parts lines a COGS post should cover.
 *
 * Lifted out of app/api/repairs/[id]/parts-cogs/route.ts: a Next 15 route file
 * may only export route handlers and route config, and this was exported
 * solely so a test could import it — which made the whole project fail a clean
 * build. Pure, so it belongs here anyway.
 */
type ConsumedLine = { productId: string; qty: number }

/**
 * Lines whose COGS this request should post.
 *
 * The caller may name them explicitly. QC stamps `usedDate` locally and only
 * then syncs the repair, so the server's copy still shows the parts
 * unconsumed while the POST is in flight — filtering on `usedDate` here made
 * every QC pass report "no consumed parts" and the repair-parts journal was
 * never written. Explicit lines are still bounded by what the repair actually
 * records, so a caller cannot post COGS for parts this repair never used.
 * With no explicit lines (the admin backfill, a finance retry) the stored
 * `usedDate` remains the selector.
 */
export function resolveConsumedLines(
  repair: { partsUsed?: unknown },
  requested?: unknown,
): { lines: ConsumedLine[]; rejected: string[] } {
  const recorded = new Map<string, number>()
  for (const part of Array.isArray(repair.partsUsed) ? repair.partsUsed : []) {
    const productId = String((part as any)?.productId ?? '')
    const qty = Math.floor(Number((part as any)?.qty) || 0)
    if (!productId || qty <= 0) continue
    recorded.set(productId, (recorded.get(productId) ?? 0) + qty)
  }

  if (Array.isArray(requested) && requested.length > 0) {
    const lines: ConsumedLine[] = []
    const rejected: string[] = []
    for (const row of requested) {
      const productId = String((row as any)?.productId ?? '')
      const allowed = recorded.get(productId)
      if (!productId || !allowed) {
        if (productId) rejected.push(productId)
        continue
      }
      const qty = Math.max(1, Math.min(allowed, Math.floor(Number((row as any)?.qty) || 1)))
      lines.push({ productId, qty })
    }
    return { lines, rejected }
  }

  const lines = (Array.isArray(repair.partsUsed) ? repair.partsUsed : [])
    .filter((p: any) => p?.usedDate && p?.productId && Number(p?.qty) > 0)
    .map((p: any) => ({
      productId: String(p.productId),
      qty: Math.max(1, Math.floor(Number(p.qty) || 1)),
    }))
  return { lines, rejected: [] }
}

