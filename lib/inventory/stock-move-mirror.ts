import 'server-only'
import { createHash } from 'crypto'
import type { StockMovementType } from '@prisma/client'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const HASH_KEY = 'stock_move_mirror_hashes_v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

function asUuid(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return UUID_RE.test(s) ? s : null
}

function asDate(v: unknown): Date {
  if (!v) return new Date()
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function mapMovementType(type: unknown, reason: unknown, qty: number): StockMovementType {
  const t = String(type ?? '').toLowerCase()
  const reasonStr = String(reason ?? '').toLowerCase()
  if (reasonStr.includes('opening')) return 'opening_stock'
  if (t === 'in') {
    if (reasonStr.includes('adjust')) return 'adjustment_in'
    if (reasonStr.includes('return')) return 'return_from_client'
    return 'purchase_receive'
  }
  if (t === 'out') {
    if (reasonStr.includes('adjust') || reasonStr.includes('write')) return 'write_off'
    if (reasonStr.includes('repair')) return 'repair_use'
    return 'sale'
  }
  if (t === 'transfer') return 'transfer'
  if (t === 'adjustment') return qty < 0 ? 'adjustment_out' : 'adjustment_in'
  if (t === 'return') return 'return_from_client'
  return 'adjustment_in'
}

let _running = false

/**
 * Dual-write `deed_stockMoves` → `stock_movements`.
 * One Prisma row per blob move (parity by count). Serial strings kept on
 * `serial_numbers` array; first matching UUID/serial sets serialNumberId.
 */
export async function mirrorStockMovesToPrisma(input: unknown, opts: { force?: boolean } = {}) {
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

    const [products, users, serials] = await Promise.all([
      prisma.product.findMany({ select: { id: true } }),
      prisma.user.findMany({ select: { id: true } }),
      prisma.serialNumber.findMany({ select: { id: true, serialNumber: true } }),
    ])
    const productIds = new Set(products.map(p => p.id))
    const userIds = new Set(users.map(u => u.id))
    const serialById = new Map(serials.map(s => [s.id, s.id]))
    const serialByNumber = new Map(serials.map(s => [s.serialNumber.toLowerCase(), s.id]))

    for (const r of rows) {
      const blobId = String(r?.id ?? '').trim()
      if (!blobId) continue
      try {
        const productId = asUuid(r.productId) && productIds.has(String(r.productId))
          ? String(r.productId)
          : null
        if (!productId) {
          result.failed++
          continue
        }

        const serialList: string[] = Array.isArray(r.serialNumbers)
          ? r.serialNumbers.map((s: unknown) => String(s)).filter(Boolean)
          : []
        let serialNumberId: string | null = null
        for (const sn of serialList) {
          if (UUID_RE.test(sn) && serialById.has(sn)) {
            serialNumberId = sn
            break
          }
          const byNum = serialByNumber.get(sn.toLowerCase())
          if (byNum) {
            serialNumberId = byNum
            break
          }
        }

        const qty = Math.max(0, Math.abs(Number(r.qty) || 0))
        const mapped = {
          blobId,
          productId,
          serialNumberId,
          movementType: mapMovementType(r.type, r.reason, Number(r.qty) || 0),
          qty,
          qtyBefore: 0,
          qtyAfter: 0,
          referenceType: 'blob_stock_move',
          referenceId: null as string | null,
          fromLocation: r.fromLocation ? String(r.fromLocation).slice(0, 40) : null,
          toLocation: r.toLocation ? String(r.toLocation).slice(0, 40) : null,
          documentRef: r.documentRef ? String(r.documentRef).slice(0, 80) : null,
          serialNumbers: serialList,
          notes: r.reason ? String(r.reason) : null,
          createdById:
            asUuid(r.userId) && userIds.has(String(r.userId)) ? String(r.userId) : null,
          createdAt: asDate(r.date),
        }
        const fp = fingerprint(mapped)
        if (!opts.force && hashes[blobId] === fp) {
          result.skipped++
          continue
        }

        const id = asUuid(blobId) ?? uuidFromKey('stock-move', blobId)
        const existing = await prisma.stockMovement.findFirst({
          where: { OR: [{ blobId }, { id }] },
          select: { id: true },
        })
        if (existing) {
          await prisma.stockMovement.update({
            where: { id: existing.id },
            data: mapped,
          })
        } else {
          await prisma.stockMovement.create({
            data: { id, ...mapped },
          })
        }

        nextHashes[blobId] = fp
        dirty = true
        result.mirrored++
      } catch (err) {
        console.error('[stock-move-mirror] row failed', blobId, err)
        result.failed++
      }
    }

    if (dirty) await saveStoreKeys({ [HASH_KEY]: JSON.stringify(nextHashes) })
    return result
  } catch (err) {
    console.error('[stock-move-mirror] failed', err)
    return result
  } finally {
    _running = false
  }
}
