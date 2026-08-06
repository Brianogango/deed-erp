import 'server-only'
import prisma from '@/lib/prisma'

/** Inventory blob keys served Prisma-first (blob used only to enrich missing fields). */
export const PRISMA_READ_INVENTORY_KEYS = [
  'deed_serials',
  'deed_stockMoves',
  'deed_purchaseOrders',
  'deed_receipts',
  'deed_bulkStock',
  'deed_deliveries',
] as const

export type PrismaReadInventoryKey = (typeof PRISMA_READ_INVENTORY_KEYS)[number]

/** Default ON. Set INVENTORY_PRISMA_READ=0 to force blob-only reads. */
export function inventoryPrismaReadsEnabled(): boolean {
  return process.env.INVENTORY_PRISMA_READ !== '0'
}

function isoDate(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined
  const dt = d instanceof Date ? d : new Date(String(d))
  if (Number.isNaN(dt.getTime())) return undefined
  return dt.toISOString().slice(0, 10)
}

function isoDateTime(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined
  const dt = d instanceof Date ? d : new Date(String(d))
  if (Number.isNaN(dt.getTime())) return undefined
  return dt.toISOString()
}

function mapPoStatusToBlob(status: string): string {
  switch (status) {
    case 'draft':
      return 'draft'
    case 'pending_approval':
      return 'sent'
    case 'approved':
      return 'confirmed'
    case 'partially_received':
      return 'partial'
    case 'received':
      return 'received'
    case 'cancelled':
      return 'cancelled'
    default:
      return status || 'draft'
  }
}

function mapMoveTypeToBlob(movementType: string): 'in' | 'out' | 'transfer' | 'adjustment' | 'return' {
  switch (movementType) {
    case 'purchase_receive':
    case 'opening_stock':
    case 'adjustment_in':
      return 'in'
    case 'sale':
    case 'repair_use':
    case 'write_off':
      return 'out'
    case 'transfer':
      return 'transfer'
    case 'return_from_client':
    case 'return_to_supplier':
      return 'return'
    case 'adjustment_out':
      return 'adjustment'
    default:
      return 'adjustment'
  }
}

function blobById(blob: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  if (!Array.isArray(blob)) return map
  for (const row of blob) {
    if (!row || typeof row !== 'object') continue
    const id = String((row as { id?: unknown }).id ?? '').trim()
    if (id) map.set(id, row as Record<string, unknown>)
  }
  return map
}

function enrich(base: Record<string, unknown>, blobRow?: Record<string, unknown>) {
  if (!blobRow) return base
  // Keep blob-only fields that Prisma does not store yet.
  const keep = { ...blobRow, ...base }
  for (const [k, v] of Object.entries(blobRow)) {
    if (base[k] == null && v != null) keep[k] = v
  }
  return keep
}

async function loadSerials(blob: unknown) {
  const rows = await prisma.serialNumber.findMany({ orderBy: { updatedAt: 'desc' } })
  const prior = blobById(blob)
  return rows.map(r => {
    const id = r.blobId || r.id
    return enrich(
      {
        id,
        serial: r.serialNumber,
        productId: r.productId,
        productName: r.productName || '',
        location: r.location || 'warehouse',
        status: r.status === 'in_stock' ? 'available' : r.status,
        barcode: r.inventoryBarcode || r.serialNumber,
        receivedDate: isoDate(r.receivedDate) || isoDate(r.createdAt),
        soldDate: isoDate(r.soldDate),
        accessoryNotes: r.notes || undefined,
      },
      prior.get(id),
    )
  })
}

async function loadStockMoves(blob: unknown) {
  const rows = await prisma.stockMovement.findMany({
    orderBy: { createdAt: 'desc' },
    include: { product: { select: { name: true } } },
  })
  const prior = blobById(blob)
  return rows.map(r => {
    const id = r.blobId || r.id
    return enrich(
      {
        id,
        type: mapMoveTypeToBlob(String(r.movementType)),
        productId: r.productId,
        productName: r.product?.name || '',
        qty: r.qty,
        reason: r.notes || '',
        fromLocation: r.fromLocation || undefined,
        toLocation: r.toLocation || undefined,
        serialNumbers: r.serialNumbers?.length ? r.serialNumbers : [],
        date: isoDate(r.createdAt) || new Date().toISOString().slice(0, 10),
        userId: r.createdById || '',
        documentRef: r.documentRef || '',
      },
      prior.get(id),
    )
  })
}

async function loadPurchaseOrders(blob: unknown) {
  const rows = await prisma.purchaseOrder.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      items: true,
      grns: { select: { id: true, blobId: true } },
      supplier: { select: { id: true, name: true } },
    },
  })
  const prior = blobById(blob)
  return rows.map(r => {
    const id = r.blobId || r.id
    const blobRow = prior.get(id)
    const blobLines = Array.isArray(blobRow?.lines)
      ? (blobRow!.lines as Record<string, unknown>[])
      : []
    const lineById = new Map(blobLines.map(l => [String(l.id ?? ''), l]))
    const lineByProduct = new Map(blobLines.map(l => [String(l.productId ?? ''), l]))
    return enrich(
      {
        id,
        ref: r.poNumber,
        status: mapPoStatusToBlob(String(r.status)),
        vendorId: r.supplierId,
        vendorName: r.vendorName || r.supplier?.name || '',
        date: isoDate(r.orderDate),
        expectedDate: isoDate(r.expectedDate) || '',
        lines: r.items.map(item => {
          const priorLine = lineById.get(item.id) || lineByProduct.get(item.productId)
          return enrich(
            {
              id: item.id,
              productId: item.productId,
              productName: item.description || '',
              qty: item.qtyOrdered,
              qtyReceived: item.qtyReceived,
              qtyBilled: item.qtyBilled,
              unitPrice: Number(item.unitCost),
              taxRate: Number(item.taxRate),
              subtotal: Number(item.lineTotal),
              requiresSerial: Boolean(priorLine?.requiresSerial),
            },
            priorLine,
          )
        }),
        subtotal: Number(r.subtotal),
        taxTotal: Number(r.taxAmount),
        total: Number(r.totalAmount),
        notes: r.notes || '',
        receiptIds: r.grns.map(g => g.blobId || g.id),
        lockVersion: r.lockVersion,
      },
      blobRow,
    )
  })
}

async function loadReceipts(blob: unknown) {
  const rows = await prisma.goodsReceivedNote.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      items: true,
      po: { select: { id: true, blobId: true, poNumber: true, supplierId: true, vendorName: true } },
    },
  })
  const prior = blobById(blob)
  return rows.map(r => {
    const id = r.blobId || r.id
    const blobRow = prior.get(id)
    const blobLines = Array.isArray(blobRow?.lines)
      ? (blobRow!.lines as Record<string, unknown>[])
      : []
    const lineByProduct = new Map(blobLines.map(l => [String(l.productId ?? ''), l]))
    return enrich(
      {
        id,
        ref: r.grnNumber,
        poId: r.po?.blobId || r.poId,
        poRef: r.po?.poNumber || '',
        vendorId: r.po?.supplierId || '',
        vendorName: r.vendorName || r.po?.vendorName || '',
        status: r.status === 'validated' ? 'validated' : String(r.status || 'draft'),
        date: isoDate(r.receivedDate),
        lines: r.items.map(item => {
          const priorLine = lineByProduct.get(item.productId)
          return enrich(
            {
              productId: item.productId,
              productName: item.productName || '',
              qtyExpected: item.qtyExpected,
              qtyReceived: item.qtyReceived,
              serials: item.serialNumbers || [],
              requiresSerial: Boolean(priorLine?.requiresSerial) || (item.serialNumbers?.length ?? 0) > 0,
            },
            priorLine,
          )
        }),
        destinationLocation: r.destinationLocation || 'warehouse',
      },
      blobRow,
    )
  })
}

async function loadBulkStock(blob: unknown) {
  const rows = await prisma.bulkStockLevel.findMany()
  const prior = new Map<string, Record<string, unknown>>()
  if (Array.isArray(blob)) {
    for (const row of blob) {
      if (!row || typeof row !== 'object') continue
      const r = row as { productId?: string; location?: string }
      const key = `${r.productId}:${r.location || 'warehouse'}`
      prior.set(key, row as Record<string, unknown>)
    }
  }
  return rows.map(r => {
    const key = `${r.productId}:${r.location}`
    return enrich(
      {
        productId: r.productId,
        location: r.location,
        qty: r.qty,
      },
      prior.get(key),
    )
  })
}

async function loadDeliveries(blob: unknown) {
  const rows = await prisma.deliveryNote.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { items: { orderBy: { lineOrder: 'asc' } } },
  })
  const prior = blobById(blob)
  return rows.map(r => {
    const id = r.blobId || r.id
    return enrich(
      {
        id,
        ref: r.dnNumber,
        saleOrderId: r.saleOrderId || '',
        saleOrderRef: r.saleOrderRef || '',
        customerId: r.clientId || '',
        customerName: r.customerName || '',
        status: r.status,
        date: isoDate(r.deliveryDate),
        warrantyCreated: r.warrantyCreated,
        backorderOfId: r.backorderOfId || undefined,
        backorderOfRef: r.backorderOfRef || undefined,
        recipientName: r.recipientName || undefined,
        recipientPhone: r.recipientPhone || undefined,
        recipientIdNumber: r.recipientIdNumber || undefined,
        deliveryAddress: r.deliveryAddress || undefined,
        notes: r.notes || undefined,
        preparedAt: isoDateTime(r.preparedAt),
        preparedByUserId: r.preparedById || undefined,
        deliveryNoteGeneratedAt: isoDateTime(r.deliveryNoteGeneratedAt),
        deliveryNoteGeneratedByUserId: r.deliveryNoteGeneratedById || undefined,
        lines: r.items.map(item => ({
          productId: item.productId || '',
          productName: item.productName || '',
          qty: item.qty,
          qtyDone: item.qtyDone,
          serialIds: item.serialIds?.length ? item.serialIds : (item.serialNumberId ? [item.serialNumberId] : []),
          sourceLocation: item.sourceLocation || undefined,
        })),
      },
      prior.get(id),
    )
  })
}

/**
 * Overlay Prisma-backed inventory arrays onto an app_state map.
 * Blob rows enrich Prisma projections for fields not yet relational.
 * Failures are swallowed per-key so blob remains available.
 */
export async function overlayInventoryPrismaReads(
  state: Record<string, unknown>,
  keys?: string[],
): Promise<Record<string, unknown>> {
  if (!inventoryPrismaReadsEnabled()) return state
  const want = keys?.length
    ? keys.filter((k): k is PrismaReadInventoryKey =>
        (PRISMA_READ_INVENTORY_KEYS as readonly string[]).includes(k),
      )
    : [...PRISMA_READ_INVENTORY_KEYS]

  if (!want.length) return state
  const next = { ...state }

  await Promise.all(
    want.map(async key => {
      try {
        const blob = state[key]
        switch (key) {
          case 'deed_serials':
            next[key] = await loadSerials(blob)
            break
          case 'deed_stockMoves':
            next[key] = await loadStockMoves(blob)
            break
          case 'deed_purchaseOrders':
            next[key] = await loadPurchaseOrders(blob)
            break
          case 'deed_receipts':
            next[key] = await loadReceipts(blob)
            break
          case 'deed_bulkStock':
            next[key] = await loadBulkStock(blob)
            break
          case 'deed_deliveries':
            next[key] = await loadDeliveries(blob)
            break
        }
      } catch (err) {
        console.error(`[prisma-read] ${key} overlay failed — keeping blob`, err)
      }
    }),
  )

  return next
}

/** Fingerprint fragment for ETag when Prisma inventory reads are enabled. */
export async function inventoryPrismaReadVersion(keys: string[]): Promise<string> {
  if (!inventoryPrismaReadsEnabled()) return ''
  const want = keys.filter(k => (PRISMA_READ_INVENTORY_KEYS as readonly string[]).includes(k))
  if (!want.length) return ''
  try {
    const parts: string[] = []
    if (want.includes('deed_serials')) {
      const r = await prisma.serialNumber.aggregate({ _count: true, _max: { updatedAt: true } })
      parts.push(`serials:${r._count}:${r._max.updatedAt?.toISOString() ?? ''}`)
    }
    if (want.includes('deed_stockMoves')) {
      const r = await prisma.stockMovement.aggregate({ _count: true, _max: { createdAt: true } })
      parts.push(`moves:${r._count}:${r._max.createdAt?.toISOString() ?? ''}`)
    }
    if (want.includes('deed_purchaseOrders')) {
      const r = await prisma.purchaseOrder.aggregate({ _count: true, _max: { updatedAt: true } })
      parts.push(`pos:${r._count}:${r._max.updatedAt?.toISOString() ?? ''}`)
    }
    if (want.includes('deed_receipts')) {
      const r = await prisma.goodsReceivedNote.aggregate({ _count: true, _max: { createdAt: true } })
      parts.push(`grns:${r._count}:${r._max.createdAt?.toISOString() ?? ''}`)
    }
    if (want.includes('deed_bulkStock')) {
      const r = await prisma.bulkStockLevel.aggregate({ _count: true, _max: { updatedAt: true } })
      parts.push(`bulk:${r._count}:${r._max.updatedAt?.toISOString() ?? ''}`)
    }
    if (want.includes('deed_deliveries')) {
      const r = await prisma.deliveryNote.aggregate({ _count: true, _max: { updatedAt: true } })
      parts.push(`dns:${r._count}:${r._max.updatedAt?.toISOString() ?? ''}`)
    }
    return parts.join('|')
  } catch {
    return ''
  }
}
