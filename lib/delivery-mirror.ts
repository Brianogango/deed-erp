import 'server-only'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'

const HASH_KEY = 'delivery_note_mirror_hashes_v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fingerprint(v: unknown) {
  return createHash('md5').update(JSON.stringify(v)).digest('hex')
}

/**
 * Best-effort dual-write: deed_deliveries (blob) → delivery_notes +
 * delivery_note_items (Prisma). Never authoritative — the blob remains the
 * operational source of truth for Sales UI, PDFs, and reports; this only
 * gives deliveries a durable relational shadow (P1-ARCH-001 follow-up).
 * Never deletes rows, never throws — a mirror failure must not fail the
 * blob write that actually recorded the delivery.
 *
 * Uses the delivery's OWN blob id as the Prisma row id (matching the
 * convention already found in an earlier, uncommitted backfill of this
 * same table on production — see the migration file for context) rather
 * than a derived id, so this mirror and that backfill agree on identity.
 */
export async function mirrorDeliveryToPrisma(delivery: unknown): Promise<{ mirrored: boolean; reason?: string }> {
  try {
    const d = delivery as Record<string, any>
    const blobId = String(d?.id ?? '').trim()
    if (!blobId || !UUID_RE.test(blobId)) return { mirrored: false, reason: 'no usable id' }

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

    // The blob never reliably tracked who created a delivery — prepared-by
    // is the closest signal, and null (not a guessed fallback user) when
    // even that is absent, matching column nullability and the pattern in
    // rows already on production from a prior mirror attempt.
    const createdById = UUID_RE.test(String(d.preparedByUserId || '')) ? String(d.preparedByUserId) : null

    const lines: any[] = Array.isArray(d.lines) ? d.lines : []
    const productIds = [...new Set(lines.map(l => String(l?.productId || '')).filter(id => UUID_RE.test(id)))]
    const validProductIds = productIds.length
      ? new Set((await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })).map(p => p.id))
      : new Set<string>()

    const mapped = {
      dnNumber: String(d.ref || blobId).slice(0, 30),
      blobId,
      saleOrderId,
      saleOrderRef: d.saleOrderRef ? String(d.saleOrderRef).slice(0, 40) : null,
      clientId,
      customerName: d.customerName ? String(d.customerName).slice(0, 200) : null,
      status: String(d.status || 'draft').slice(0, 30),
      deliveryAddress: d.deliveryAddress ? String(d.deliveryAddress) : null,
      recipientName: d.recipientName ? String(d.recipientName).slice(0, 150) : null,
      recipientPhone: d.recipientPhone ? String(d.recipientPhone).slice(0, 20) : null,
      recipientIdNumber: d.recipientIdNumber ? String(d.recipientIdNumber).slice(0, 40) : null,
      notes: d.notes ? String(d.notes) : null,
      backorderOfId: UUID_RE.test(String(d.backorderOfId || '')) ? String(d.backorderOfId) : null,
      backorderOfRef: d.backorderOfRef ? String(d.backorderOfRef).slice(0, 40) : null,
      preparedAt: d.preparedAt ? new Date(d.preparedAt) : null,
      preparedById: createdById,
      deliveryNoteGeneratedAt: d.deliveryNoteGeneratedAt ? new Date(d.deliveryNoteGeneratedAt) : null,
      createdById,
      lineItems: lines.map((l, i) => ({
        productId: UUID_RE.test(String(l?.productId || '')) && validProductIds.has(String(l.productId)) ? String(l.productId) : null,
        productName: l?.productName ? String(l.productName).slice(0, 200) : null,
        description: l?.productName ? String(l.productName) : null,
        qty: Math.max(0, Number(l?.qty) || 0),
        qtyDone: Math.max(0, Number(l?.qtyDone) || 0),
        qtyReturned: Math.max(0, Number(l?.qtyReturned) || 0),
        serialIds: Array.isArray(l?.serialIds) ? l.serialIds.map((s: unknown) => String(s)) : [],
        serialNumberId: Array.isArray(l?.serialIds) && UUID_RE.test(String(l.serialIds[0] || ''))
          ? String(l.serialIds[0])
          : null,
        sourceLocation: l?.sourceLocation ? String(l.sourceLocation).slice(0, 40) : null,
        lineOrder: i,
      })),
    }

    const fp = fingerprint(mapped)
    if (hashes[blobId] === fp) return { mirrored: false, reason: 'unchanged' }

    const { lineItems, ...dnData } = mapped
    await prisma.$transaction(async tx => {
      await tx.deliveryNote.upsert({
        where: { blobId },
        create: { id: blobId, ...dnData },
        update: dnData,
      })
      await tx.deliveryNoteItem.deleteMany({ where: { dnId: blobId } })
      if (lineItems.length > 0) {
        await tx.deliveryNoteItem.createMany({
          data: lineItems.map(item => ({ dnId: blobId, ...item })),
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
