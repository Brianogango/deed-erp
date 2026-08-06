import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const HASH_KEY = 'delivery_mirror_hashes_v1'
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

function prismaIdForBlob(blobId: string): string {
  return UUID_RE.test(blobId) ? blobId : uuidFromKey('delivery', blobId)
}

let _running = false

/**
 * Dual-write `deed_deliveries` → `delivery_notes` + `delivery_note_items`.
 * Never deletes blob rows. Upserts by blobId (or UUID id when present).
 * Safe to call fire-and-forget from saveStoreKeys.
 */
export async function mirrorDeliveriesToPrisma(input: unknown, opts: { force?: boolean } = {}) {
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

    const [products, clients, saleOrders, users] = await Promise.all([
      prisma.product.findMany({ select: { id: true } }),
      prisma.client.findMany({ select: { id: true } }),
      prisma.saleOrder.findMany({ select: { id: true } }),
      prisma.user.findMany({ select: { id: true } }),
    ])
    const productIds = new Set(products.map(p => p.id))
    const clientIds = new Set(clients.map(c => c.id))
    const saleOrderIds = new Set(saleOrders.map(s => s.id))
    const userIds = new Set(users.map(u => u.id))

    for (const r of rows) {
      const blobId = String(r?.id ?? '').trim()
      if (!blobId) continue
      try {
        const saleOrderId = asUuid(r.saleOrderId) && saleOrderIds.has(String(r.saleOrderId))
          ? String(r.saleOrderId)
          : null
        const clientId = asUuid(r.customerId) && clientIds.has(String(r.customerId))
          ? String(r.customerId)
          : null
        const createdById =
          (asUuid(r.createdByUserId) && userIds.has(String(r.createdByUserId))
            ? String(r.createdByUserId)
            : null) ||
          (asUuid(r.preparedByUserId) && userIds.has(String(r.preparedByUserId))
            ? String(r.preparedByUserId)
            : null)
        const preparedById =
          asUuid(r.preparedByUserId) && userIds.has(String(r.preparedByUserId))
            ? String(r.preparedByUserId)
            : null
        const dnGeneratedById =
          asUuid(r.deliveryNoteGeneratedByUserId) && userIds.has(String(r.deliveryNoteGeneratedByUserId))
            ? String(r.deliveryNoteGeneratedByUserId)
            : null

        const lines = Array.isArray(r.lines) ? r.lines : []
        type LinePayload = {
          productId: string | null
          productName: string | null
          description: string | null
          qty: number
          qtyDone: number
          serialIds: string[]
          serialNumberId: string | null
          sourceLocation: string | null
          lineOrder: number
        }
        const linePayload: LinePayload[] = lines.map((line: any, idx: number): LinePayload => {
          const productId =
            asUuid(line.productId) && productIds.has(String(line.productId))
              ? String(line.productId)
              : null
          const serialIds = Array.isArray(line.serialIds)
            ? line.serialIds.map((id: unknown) => String(id)).filter(Boolean)
            : []
          const firstSerial = serialIds.find((id: string) => UUID_RE.test(id)) ?? null
          return {
            productId,
            productName: line.productName ? String(line.productName).slice(0, 200) : null,
            description: line.productName ? String(line.productName) : null,
            qty: Math.max(0, Number(line.qty) || 0),
            qtyDone: Math.max(0, Number(line.qtyDone) || 0),
            serialIds,
            serialNumberId: firstSerial,
            sourceLocation: line.sourceLocation ? String(line.sourceLocation).slice(0, 40) : null,
            lineOrder: idx,
          }
        })

        const header = {
          blobId,
          dnNumber: String(r.ref || blobId).slice(0, 30),
          saleOrderId,
          clientId,
          saleOrderRef: r.saleOrderRef ? String(r.saleOrderRef).slice(0, 40) : null,
          customerName: r.customerName ? String(r.customerName).slice(0, 200) : null,
          status: String(r.status || 'waiting').slice(0, 30),
          deliveryDate: asDate(r.date),
          deliveryAddress: r.deliveryAddress ? String(r.deliveryAddress) : null,
          recipientName: r.recipientName ? String(r.recipientName).slice(0, 150) : null,
          recipientPhone: r.recipientPhone ? String(r.recipientPhone).slice(0, 20) : null,
          recipientIdNumber: r.recipientIdNumber ? String(r.recipientIdNumber).slice(0, 40) : null,
          notes: r.notes ? String(r.notes) : null,
          warrantyCreated: Boolean(r.warrantyCreated),
          backorderOfId: asUuid(r.backorderOfId),
          backorderOfRef: r.backorderOfRef ? String(r.backorderOfRef).slice(0, 40) : null,
          preparedAt: asDate(r.preparedAt),
          preparedById,
          deliveryNoteGeneratedAt: asDate(r.deliveryNoteGeneratedAt),
          deliveryNoteGeneratedById: dnGeneratedById,
          createdById,
        }

        const fp = fingerprint({ header, lines: linePayload })
        if (!opts.force && hashes[blobId] === fp) {
          result.skipped++
          continue
        }

        const id = prismaIdForBlob(blobId)
        await prisma.$transaction(async tx => {
          const existing = await tx.deliveryNote.findFirst({
            where: { OR: [{ blobId }, { id }] },
            select: { id: true },
          })
          const dnId = existing?.id ?? id
          if (existing) {
            await tx.deliveryNote.update({
              where: { id: dnId },
              data: header,
            })
            await tx.deliveryNoteItem.deleteMany({ where: { dnId } })
          } else {
            await tx.deliveryNote.create({
              data: { id: dnId, ...header },
            })
          }
          if (linePayload.length) {
            await tx.deliveryNoteItem.createMany({
              data: linePayload.map(line => ({
                id: uuidFromKey('dn-line', `${blobId}:${line.lineOrder}`),
                dnId,
                ...line,
              })),
            })
          }
        })

        nextHashes[blobId] = fp
        dirty = true
        result.mirrored++
      } catch (err) {
        console.error('[delivery-mirror] row failed', blobId, err)
        result.failed++
      }
    }

    if (dirty) await saveStoreKeys({ [HASH_KEY]: JSON.stringify(nextHashes) })
    return result
  } catch (err) {
    console.error('[delivery-mirror] failed', err)
    return result
  } finally {
    _running = false
  }
}
