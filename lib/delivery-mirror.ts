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
function mapDeliveryFields(d: Record<string, any>, validProductIds: Set<string>) {
  const blobId = String(d?.id ?? '').trim()
  const saleOrderId = UUID_RE.test(String(d.saleOrderId || '')) ? String(d.saleOrderId) : null
  const clientId = UUID_RE.test(String(d.customerId || '')) ? String(d.customerId) : null
  const createdById = UUID_RE.test(String(d.preparedByUserId || '')) ? String(d.preparedByUserId) : null
  const lines: any[] = Array.isArray(d.lines) ? d.lines : []
  return {
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
}

/**
 * Batch-mirror an array of deliveries. Replaces the N+1 loop that called
 * mirrorDeliveryToPrisma once per delivery — each of which loaded/saved the
 * hash map and ran individual client/product lookups (5N DB round-trips → ~5).
 */
export async function mirrorDeliveriesToPrisma(deliveries: unknown[]): Promise<void> {
  if (!deliveries.length) return
  try {
    const state = await loadAppState([HASH_KEY])
    const hashes: Record<string, string> = state[HASH_KEY] && typeof state[HASH_KEY] === 'object'
      ? { ...(state[HASH_KEY] as Record<string, string>) }
      : {}

    const preCandidates: { d: Record<string, any>; blobId: string; clientId: string }[] = []
    for (const delivery of deliveries) {
      const d = delivery as Record<string, any>
      const blobId = String(d?.id ?? '').trim()
      if (!blobId || !UUID_RE.test(blobId)) continue
      const clientId = UUID_RE.test(String(d.customerId || '')) ? String(d.customerId) : null
      if (!clientId) continue
      preCandidates.push({ d, blobId, clientId })
    }
    if (!preCandidates.length) return

    const clientIds = [...new Set(preCandidates.map(c => c.clientId))]
    const validClients = new Set(
      (await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true } })).map(c => c.id),
    )
    const withClient = preCandidates.filter(c => validClients.has(c.clientId))
    if (!withClient.length) return

    const allProductIds = [...new Set(
      withClient.flatMap(c => {
        const lines: any[] = Array.isArray(c.d.lines) ? c.d.lines : []
        return lines.map(l => String(l?.productId || '')).filter(id => UUID_RE.test(id))
      }),
    )]
    const validProducts = allProductIds.length
      ? new Set((await prisma.product.findMany({ where: { id: { in: allProductIds } }, select: { id: true } })).map(p => p.id))
      : new Set<string>()

    type Mapped = ReturnType<typeof mapDeliveryFields>
    const changed: { blobId: string; mapped: Mapped; fp: string }[] = []
    for (const c of withClient) {
      const mapped = mapDeliveryFields(c.d, validProducts)
      const fp = fingerprint(mapped)
      if (hashes[c.blobId] === fp) continue
      changed.push({ blobId: c.blobId, mapped, fp })
    }
    if (changed.length > 0) {
      const changedBlobIds = changed.map(c => c.blobId)
      await prisma.$transaction(async tx => {
        for (const c of changed) {
          const { lineItems, ...dnData } = c.mapped
          await tx.deliveryNote.upsert({
            where: { blobId: c.blobId },
            create: { id: c.blobId, ...dnData },
            update: dnData,
          })
        }
        await tx.deliveryNoteItem.deleteMany({ where: { dnId: { in: changedBlobIds } } })
        const allItems = changed.flatMap(c =>
          c.mapped.lineItems.map(item => ({ dnId: c.blobId, ...item })),
        )
        if (allItems.length > 0) {
          await tx.deliveryNoteItem.createMany({ data: allItems })
        }
      })

      for (const c of changed) hashes[c.blobId] = c.fp
    }

    const activeIds = new Set(deliveries.map(d => String((d as Record<string, any>)?.id ?? '').trim()).filter(Boolean))
    let evicted = 0
    for (const id of Object.keys(hashes)) {
      if (!activeIds.has(id)) { delete hashes[id]; evicted++ }
    }

    if (changed.length > 0 || evicted > 0) {
      await saveStoreKeys({ [HASH_KEY]: JSON.stringify(hashes) })
    }
  } catch (err) {
    console.error('[delivery-mirror] batch failed:', err)
  }
}

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
