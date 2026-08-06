import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const HASH_KEY = 'serial_mirror_hashes_v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

function asUuid(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return UUID_RE.test(s) ? s : null
}

function asDate(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Map blob status → Prisma status string (keep operational vocabulary). */
function mapStatus(raw: unknown): string {
  const s = String(raw ?? 'available').trim().toLowerCase()
  if (!s) return 'available'
  // Legacy Prisma default was in_stock; normalize to blob vocabulary.
  if (s === 'in_stock') return 'available'
  return s.slice(0, 30)
}

let _running = false

/**
 * Dual-write `deed_serials` → `serial_numbers`.
 * Upserts by blobId, then by serial string, then creates.
 * Never deletes blob rows.
 */
export async function mirrorSerialsToPrisma(input: unknown, opts: { force?: boolean } = {}) {
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
      const blobId = String(r?.id ?? '').trim()
      const serial = String(r?.serial ?? r?.serialNumber ?? '').trim()
      if (!blobId || !serial) continue
      try {
        const productId = asUuid(r.productId) && productIds.has(String(r.productId))
          ? String(r.productId)
          : null
        if (!productId) {
          result.failed++
          continue
        }

        const barcode = String(r.barcode ?? serial).trim().slice(0, 120) || null
        const notesParts = [
          r.accessoryNotes ? String(r.accessoryNotes) : '',
          Array.isArray(r.accessories) && r.accessories.length
            ? `Accessories: ${r.accessories.join(', ')}`
            : '',
          r.specs ? `Specs: ${String(r.specs)}` : '',
        ].filter(Boolean)

        const mapped = {
          blobId,
          productId,
          serialNumber: serial.slice(0, 100),
          inventoryBarcode: barcode,
          status: mapStatus(r.status),
          location: String(r.location ?? 'warehouse').slice(0, 30),
          productName: r.productName ? String(r.productName).slice(0, 200) : null,
          receivedDate: asDate(r.receivedDate),
          soldDate: asDate(r.soldDate),
          notes: notesParts.length ? notesParts.join('\n') : null,
        }
        const fp = fingerprint(mapped)
        if (!opts.force && hashes[blobId] === fp) {
          result.skipped++
          continue
        }

        const id = asUuid(blobId) ?? uuidFromKey('serial', blobId)
        const existing =
          (await prisma.serialNumber.findFirst({
            where: { OR: [{ blobId }, { id }, { serialNumber: mapped.serialNumber }] },
            select: { id: true },
          })) ?? null

        if (existing) {
          await prisma.serialNumber.update({
            where: { id: existing.id },
            data: mapped,
          })
        } else {
          // Barcode unique — clear if another row already owns it.
          if (mapped.inventoryBarcode) {
            const taken = await prisma.serialNumber.findFirst({
              where: { inventoryBarcode: mapped.inventoryBarcode },
              select: { id: true },
            })
            if (taken) mapped.inventoryBarcode = null
          }
          await prisma.serialNumber.create({
            data: { id, ...mapped },
          })
        }

        nextHashes[blobId] = fp
        dirty = true
        result.mirrored++
      } catch (err) {
        console.error('[serial-mirror] row failed', blobId, err)
        result.failed++
      }
    }

    if (dirty) await saveStoreKeys({ [HASH_KEY]: JSON.stringify(nextHashes) })
    return result
  } catch (err) {
    console.error('[serial-mirror] failed', err)
    return result
  } finally {
    _running = false
  }
}
