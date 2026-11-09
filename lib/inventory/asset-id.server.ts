import 'server-only'
import { reserveCounterValues } from '@/lib/doc-ref-counter'
import { assetIdPrefix, formatAssetId, highestAssetNumber, normalizeAssetId } from './asset-id'

type SerialLike = { assetId?: unknown } & Record<string, unknown>

/**
 * `count` new asset IDs for a category, from the shared atomic counter (one
 * per prefix). The first use starts after the highest one already on a
 * machine, so numbers carry on from what exists.
 */
export async function allocateAssetIds(category: string | null | undefined, count: number, serials: SerialLike[]): Promise<string[]> {
  if (count < 1) return []
  const prefix = assetIdPrefix(category)
  const used = new Set(serials.map(s => normalizeAssetId(s.assetId)).filter(Boolean))
  const out: string[] = []
  // A typed-in sticker can sit ahead of the counter: skip numbers already taken.
  while (out.length < count) {
    const need = count - out.length
    const last = await reserveCounterValues(`asset_${prefix}`, need, async () => highestAssetNumber(prefix, used))
    for (let n = last - need + 1; n <= last; n++) {
      const id = formatAssetId(prefix, n)
      if (!used.has(id)) { used.add(id); out.push(id) }
    }
  }
  return out
}
