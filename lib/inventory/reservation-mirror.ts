import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const HASH_KEY = 'stock_reservation_mirror_hashes_v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

let _running = false

/**
 * Dual-write deed_stockReservations → stock_reservations.
 * Never deletes blob rows. Updates status in place by blob_id.
 * Active serial uniqueness is enforced by partial unique index in SQL.
 */
export async function mirrorStockReservationsToPrisma(input: unknown, opts: { force?: boolean } = {}) {
  const result = { mirrored: 0, skipped: 0, failed: 0 }
  if (_running) return result
  _running = true
  try {
    const rows: any[] = typeof input === 'string' ? JSON.parse(input) : (input as any[])
    if (!Array.isArray(rows) || rows.length === 0) return result

    const state = await loadAppState([HASH_KEY])
    const hashes: Record<string, string> = (!opts.force && state[HASH_KEY] && typeof state[HASH_KEY] === 'object')
      ? state[HASH_KEY] as Record<string, string>
      : {}
    const nextHashes = { ...hashes }
    let dirty = false

    const productIds = new Set((await prisma.product.findMany({ select: { id: true } })).map(p => p.id))
    const serialIds = new Set((await prisma.serialNumber.findMany({ select: { id: true } })).map(s => s.id))

    for (const r of rows) {
      const blobId = String(r?.id ?? '').trim()
      if (!blobId) continue
      try {
        const productId = r.productId && productIds.has(r.productId) ? r.productId : null
        const serialId = Array.isArray(r.serialIds) && r.serialIds[0] && serialIds.has(r.serialIds[0])
          ? r.serialIds[0]
          : (r.serialId && serialIds.has(r.serialId) ? r.serialId : null)
        const saleOrderId = r.referenceId && UUID_RE.test(String(r.referenceId)) && r.reservedFor === 'sale_order'
          ? String(r.referenceId)
          : null

        const mapped = {
          blobId,
          saleOrderId,
          saleOrderRef: r.referenceRef ? String(r.referenceRef).slice(0, 40) : null,
          productId,
          serialId,
          qty: Math.max(1, Number(r.qty) || 1),
          location: String(r.location ?? 'warehouse').slice(0, 30),
          reservedFor: r.reservedFor ? String(r.reservedFor).slice(0, 40) : null,
          referenceId: r.referenceId ? String(r.referenceId).slice(0, 80) : null,
          referenceRef: r.referenceRef ? String(r.referenceRef).slice(0, 80) : null,
          status: String(r.status ?? 'reserved').slice(0, 20),
          reservedAt: r.reservedDate ? new Date(r.reservedDate) : new Date(),
          releasedAt: r.releasedDate ? new Date(r.releasedDate) : null,
        }
        const fp = fingerprint(mapped)
        if (!opts.force && hashes[blobId] === fp) { result.skipped++; continue }

        const existing = await prisma.stockReservation.findFirst({ where: { blobId } })
        if (existing) {
          await prisma.stockReservation.update({ where: { id: existing.id }, data: mapped })
        } else {
          await prisma.stockReservation.create({
            data: { id: uuidFromKey('reservation', blobId), ...mapped },
          })
        }
        nextHashes[blobId] = fp
        dirty = true
        result.mirrored++
      } catch {
        result.failed++
      }
    }

    if (dirty) await saveStoreKeys({ [HASH_KEY]: JSON.stringify(nextHashes) })
    return result
  } finally {
    _running = false
  }
}
