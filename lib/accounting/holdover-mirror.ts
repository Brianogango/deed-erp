import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const HASH_KEY = 'holdover_mirror_hashes_v1'

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

let _running = false

/** Dual-write deed_holdovers → holdovers. Never deletes blobs. */
export async function mirrorHoldoversToPrisma(input: unknown, opts: { force?: boolean } = {}) {
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

    for (const h of rows) {
      const blobId = String(h?.id ?? '').trim()
      const ref = String(h?.ref ?? h?.id ?? '').trim()
      if (!blobId || !ref) continue
      try {
        const mapped = {
          blobId,
          ref: ref.slice(0, 40),
          customerId: h.customerId ? String(h.customerId).slice(0, 80) : null,
          customerName: h.customerName ? String(h.customerName).slice(0, 200) : null,
          customerPhone: h.customerPhone ? String(h.customerPhone).slice(0, 40) : null,
          productId: h.productId ? String(h.productId).slice(0, 80) : null,
          productName: h.productName ? String(h.productName).slice(0, 200) : null,
          serialId: h.serialId ? String(h.serialId).slice(0, 80) : null,
          serialNumber: h.serialNumber ? String(h.serialNumber).slice(0, 120) : null,
          deviceCondition: h.deviceCondition ? String(h.deviceCondition).slice(0, 40) : null,
          purpose: h.purpose ? String(h.purpose).slice(0, 40) : null,
          status: String(h.status ?? 'active').slice(0, 30),
          issuedAt: h.issuedAt || h.issueDate ? new Date(h.issuedAt || h.issueDate) : null,
          dueAt: h.dueAt || h.dueDate ? new Date(h.dueAt || h.dueDate) : null,
          returnedAt: h.returnedAt || h.returnDate ? new Date(h.returnedAt || h.returnDate) : null,
          returnCondition: h.returnCondition ? String(h.returnCondition).slice(0, 40) : null,
          notes: h.notes ? String(h.notes) : null,
          createdBy: h.createdBy ? String(h.createdBy).slice(0, 80) : null,
        }
        const fp = fingerprint(mapped)
        if (!opts.force && hashes[blobId] === fp) { result.skipped++; continue }

        const existing = await prisma.holdover.findFirst({ where: { OR: [{ blobId }, { ref: mapped.ref }] } })
        if (existing) {
          await prisma.holdover.update({ where: { id: existing.id }, data: mapped })
        } else {
          await prisma.holdover.create({ data: { id: uuidFromKey('holdover', blobId), ...mapped } })
        }
        nextHashes[blobId] = fp
        dirty = true
        result.mirrored++
      } catch {
        result.failed++
      }
    }

    const activeIds = new Set(rows.map((h: any) => String(h?.id ?? '').trim()).filter(Boolean))
    for (const id of Object.keys(nextHashes)) {
      if (!activeIds.has(id)) { delete nextHashes[id]; dirty = true }
    }

    if (dirty) await saveStoreKeys({ [HASH_KEY]: JSON.stringify(nextHashes) })
    return result
  } finally {
    _running = false
  }
}
