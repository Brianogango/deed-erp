import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { uuidFromKey } from '@/lib/accounting/ids'

const HASH_KEY = 'delivery_note_mirror_hashes_v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

/**
 * DeliveryNote.createdById is required, but deed_deliveries never tracked
 * who created a delivery — prepared-by is the closest signal. When neither
 * is available, fall back to any director/admin user so the mirror can
 * still write the row; if that also fails, the caller skips it.
 */
async function resolveFallbackCreatorId(): Promise<string | null> {
  try {
    const user = await prisma.user.findFirst({
      where: { role: { in: ['director', 'admin_officer'] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    return user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Best-effort dual-write: deed_deliveries (blob) → delivery_notes +
 * delivery_note_items (Prisma). Never authoritative — the blob remains the
 * operational source of truth for Sales UI, PDFs, and reports; this only
 * gives deliveries a durable relational shadow (P1-ARCH-001 follow-up).
 * Never deletes rows, never throws — a mirror failure must not fail the
 * blob write that actually recorded the delivery.
 */
export async function mirrorDeliveryToPrisma(delivery: unknown): Promise<{ mirrored: boolean; reason?: string }> {
  try {
    const d = delivery as Record<string, any>
    const blobId = String(d?.id ?? '').trim()
    if (!blobId) return { mirrored: false, reason: 'no id' }

    const state = await loadAppState([HASH_KEY])
    const hashes: Record<string, string> = state[HASH_KEY] && typeof state[HASH_KEY] === 'object'
      ? state[HASH_KEY] as Record<string, string>
      : {}

    const saleOrderId = UUID_RE.test(String(d.saleOrderId || '')) ? String(d.saleOrderId) : null
    const clientId = UUID_RE.test(String(d.customerId || '')) ? String(d.customerId) : null
    if (!clientId) return { mirrored: false, reason: 'no resolvable clientId' }

    // A delivery to a client not yet mirrored into Prisma (legacy/blob-only
    // contact) has nowhere to attach — skip rather than guess.
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
    if (!client) return { mirrored: false, reason: 'client not in Prisma' }

    const creatorId = (UUID_RE.test(String(d.preparedByUserId || '')) ? String(d.preparedByUserId) : null)
      ?? await resolveFallbackCreatorId()
    if (!creatorId) return { mirrored: false, reason: 'no resolvable createdById' }

    const lines = Array.isArray(d.lines) ? d.lines : []
    const productIds = [...new Set(lines.map((l: any) => String(l?.productId || '')).filter(id => UUID_RE.test(id)))]
    const validProductIds = productIds.length
      ? new Set((await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })).map(p => p.id))
      : new Set<string>()

    const mapped = {
      dnNumber: String(d.ref || blobId).slice(0, 30),
      blobId,
      saleOrderId,
      clientId,
      status: String(d.status || 'draft').slice(0, 30),
      deliveryAddress: d.deliveryAddress ? String(d.deliveryAddress) : null,
      recipientName: d.recipientName ? String(d.recipientName) : null,
      recipientPhone: d.recipientPhone ? String(d.recipientPhone) : null,
      notes: d.notes ? String(d.notes) : null,
      createdById: creatorId,
      lineItems: lines
        .filter((l: any) => validProductIds.has(String(l?.productId || '')))
        .map((l: any) => ({
          productId: String(l.productId),
          description: l.productName ? String(l.productName) : null,
          qty: Math.max(0, Number(l.qty) || 0),
          qtyDone: Math.max(0, Number(l.qtyDone) || 0),
          serialNumberId: Array.isArray(l.serialIds) && UUID_RE.test(String(l.serialIds[0] || ''))
            ? String(l.serialIds[0])
            : null,
        })),
    }

    const fp = fingerprint(mapped)
    if (hashes[blobId] === fp) return { mirrored: false, reason: 'unchanged' }

    const { lineItems, ...dnData } = mapped
    const id = uuidFromKey('delivery_note', blobId)
    await prisma.$transaction(async tx => {
      await tx.deliveryNote.upsert({
        where: { blobId },
        create: { id, ...dnData },
        update: dnData,
      })
      await tx.deliveryNoteItem.deleteMany({ where: { dnId: id } })
      if (lineItems.length > 0) {
        await tx.deliveryNoteItem.createMany({
          data: lineItems.map(item => ({ dnId: id, ...item })),
        })
      }
    })

    await saveStoreKeys({ [HASH_KEY]: JSON.stringify({ ...hashes, [blobId]: fp }) })
    return { mirrored: true }
  } catch (err) {
    console.error('[delivery-mirror] failed:', err)
    return { mirrored: false, reason: 'error' }
  }
}
