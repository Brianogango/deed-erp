import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const HASH_KEY = 'deposit_mirror_hashes_v1'

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

let _running = false

/** Dual-write deed_deposits → deposits. Never deletes blobs. */
export async function mirrorDepositsToPrisma(input: unknown, opts: { force?: boolean } = {}) {
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

    for (const d of rows) {
      const blobId = String(d?.id ?? '').trim()
      const ref = String(d?.ref ?? '').trim()
      if (!blobId || !ref) continue
      try {
        const mapped = {
          blobId,
          ref: ref.slice(0, 40),
          customerId: d.customerId ? String(d.customerId).slice(0, 80) : null,
          customerName: d.customerName ? String(d.customerName).slice(0, 200) : null,
          customerPhone: d.customerPhone ? String(d.customerPhone).slice(0, 40) : null,
          totalValue: Number(d.totalValue ?? 0),
          totalPaid: Number(d.totalPaid ?? 0),
          balance: Number(d.balance ?? 0),
          status: String(d.status ?? 'active').slice(0, 30),
          notes: d.notes ? String(d.notes) : null,
          dueDate: d.dueDate ? new Date(d.dueDate) : null,
          completedAt: d.completedAt ? new Date(d.completedAt) : null,
          cancelledAt: d.cancelledAt ? new Date(d.cancelledAt) : null,
          cancelReason: d.cancelReason ? String(d.cancelReason) : null,
          createdBy: d.createdBy ? String(d.createdBy).slice(0, 80) : null,
        }
        const items = Array.isArray(d.items) ? d.items : []
        const payments = Array.isArray(d.payments) ? d.payments : []
        const fp = fingerprint({ mapped, items, payments })
        if (!opts.force && hashes[blobId] === fp) { result.skipped++; continue }

        const existing = await prisma.deposit.findFirst({ where: { OR: [{ blobId }, { ref: mapped.ref }] } })
        const depositId = existing?.id || uuidFromKey('deposit', blobId)
        if (existing) {
          await prisma.deposit.update({ where: { id: existing.id }, data: mapped })
          await prisma.depositItem.deleteMany({ where: { depositId: existing.id } })
          await prisma.depositPayment.deleteMany({ where: { depositId: existing.id } })
        } else {
          await prisma.deposit.create({ data: { id: depositId, ...mapped } })
        }

        if (items.length) {
          await prisma.depositItem.createMany({
            data: items.map((it: any, i: number) => ({
              depositId,
              productId: it.productId ? String(it.productId).slice(0, 80) : null,
              productName: it.productName ? String(it.productName).slice(0, 200) : null,
              sku: it.sku ? String(it.sku).slice(0, 80) : null,
              qty: Math.max(1, Number(it.qty) || 1),
              unitPrice: Number(it.unitPrice ?? 0),
              lineTotal: Number(it.total ?? it.lineTotal ?? 0),
              sortOrder: i,
            })),
          })
        }
        if (payments.length) {
          await prisma.depositPayment.createMany({
            data: payments.map((p: any) => ({
              depositId,
              blobId: p.id ? String(p.id).slice(0, 80) : null,
              amount: Number(p.amount ?? 0),
              method: String(p.method ?? 'cash').slice(0, 40),
              paymentRef: p.ref ? String(p.ref).slice(0, 80) : null,
              recordedBy: p.recordedBy ? String(p.recordedBy).slice(0, 80) : null,
              paidAt: p.date ? new Date(p.date) : new Date(),
            })),
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
