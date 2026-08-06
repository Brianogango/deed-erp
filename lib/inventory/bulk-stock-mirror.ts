import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const HASH_KEY = 'bulk_stock_mirror_hashes_v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

function asUuid(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return UUID_RE.test(s) ? s : null
}

let _running = false

/**
 * Dual-write `deed_bulkStock` → `bulk_stock_levels` (product + location).
 */
export async function mirrorBulkStockToPrisma(input: unknown, opts: { force?: boolean } = {}) {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_running) return result
  _running = true
  try {
    const rows: any[] = typeof input === 'string' ? JSON.parse(input) : (input as any[])
    if (!Array.isArray(rows) || rows.length === 0) return result

    const state = await loadAppState([HASH_KEY])
    const hashes: Record<string, string> =
      !opts.force && state[HASH_KEY] && typeof state[HASH_KEY] === 'object'
        ? (state[HASH_KEY] as Record<string, string>)
        : {}
    const nextHashes = { ...hashes }
    let dirty = false

    const productIds = new Set(
      (await prisma.product.findMany({ select: { id: true } })).map(p => p.id),
    )

    for (const r of rows) {
      const productId = asUuid(r?.productId)
      if (!productId || !productIds.has(productId)) {
        result.failed++
        continue
      }
      const location = String(r.location ?? 'warehouse').slice(0, 30)
      const key = `${productId}:${location}`
      try {
        const mapped = {
          productId,
          location,
          qty: Math.max(0, Number(r.qty) || 0),
        }
        const fp = fingerprint(mapped)
        if (!opts.force && hashes[key] === fp) {
          result.skipped++
          continue
        }

        await prisma.bulkStockLevel.upsert({
          where: {
            productId_location: { productId, location },
          },
          create: {
            id: uuidFromKey('bulk-stock', key),
            ...mapped,
          },
          update: { qty: mapped.qty },
        })

        nextHashes[key] = fp
        dirty = true
        result.mirrored++
      } catch (err) {
        console.error('[bulk-stock-mirror] row failed', key, err)
        result.failed++
      }
    }

    if (dirty) await saveStoreKeys({ [HASH_KEY]: JSON.stringify(nextHashes) })
    return result
  } catch (err) {
    console.error('[bulk-stock-mirror] failed', err)
    return result
  } finally {
    _running = false
  }
}
