import { upsertBulkStock, type BulkStockLevel } from '@/lib/business-logic'
import { buildInventoryBarcode } from '@/lib/inventory-identifiers'
import { validateReceiptInput } from '@/lib/inventory-validation'
import type {
  AuditLog,
  LocationId,
  Product,
  PurchaseOrder,
  Receipt,
  RefurbishmentJob,
  SerialNumber,
  StockMove,
} from '@/lib/store'

export type ApplyReceiptLine = {
  productId: string
  productName: string
  qtyExpected: number
  qtyReceived: number
  serials: string[]
  requiresSerial: boolean
  importedSerials?: string[]
  specs?: string
}

export type ApplyReceiptInput = {
  receiptId: string
  lines: ApplyReceiptLine[]
  destination: LocationId
  serialAccessories?: Record<string, string[]>
  serialAccessoryNotes?: Record<string, string>
  serialSpecs?: Record<string, string>
  serialIssues?: Record<string, string>
  actorUserId?: string
  actorUsername?: string
  nowIsoDate?: string
}

export type ApplyReceiptState = {
  receipts: Receipt[]
  purchaseOrders: PurchaseOrder[]
  serials: SerialNumber[]
  products: Product[]
  bulkStock: BulkStockLevel[]
  stockMoves: StockMove[]
  refurbishmentJobs: RefurbishmentJob[]
  auditLogs: AuditLog[]
}

export type ApplyReceiptResult =
  | { ok: true; idempotent: boolean; state: ApplyReceiptState; followUpReceiptId?: string; message: string }
  | { ok: false; errors: string[] }

function uid() {
  return `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function today(iso?: string) {
  if (iso) return iso.slice(0, 10)
  return new Date().toISOString().slice(0, 10)
}

function docSeq(prefix: string) {
  const n = Date.now().toString().slice(-6)
  return `${prefix}/${n}`
}

/**
 * Pure GRN validation + stock apply. Idempotent when receipt is already validated.
 * Does not touch repair auto-resume (kept client-side as a follow-on).
 */
export function applyReceiptValidation(
  state: ApplyReceiptState,
  input: ApplyReceiptInput,
): ApplyReceiptResult {
  const receipt = state.receipts.find(r => r.id === input.receiptId)
  if (!receipt) return { ok: false, errors: ['Receipt not found'] }

  if (receipt.status === 'validated') {
    return {
      ok: true,
      idempotent: true,
      state,
      message: `Receipt ${receipt.ref} was already validated`,
    }
  }

  const po = state.purchaseOrders.find(p => p.id === receipt.poId)
  if (!po) return { ok: false, errors: ['Purchase order not found for receipt'] }

  const validation = validateReceiptInput(
    input.lines.map(line => ({
      productId: line.productId,
      productName: line.productName,
      qtyReceived: Number(line.qtyReceived ?? 0),
      requiresSerial: Boolean(line.requiresSerial),
      serials: line.serials ?? [],
    })),
    state.serials,
  )
  if (!validation.ok) return { ok: false, errors: validation.errors }

  const date = today(input.nowIsoDate)
  let serials = [...state.serials]
  let products = [...state.products]
  let bulkStock = [...state.bulkStock]
  let stockMoves = [...state.stockMoves]
  let refurbishmentJobs = [...state.refurbishmentJobs]
  const newSerials: SerialNumber[] = []
  const newMoves: StockMove[] = []

  for (const line of input.lines) {
    if (line.qtyReceived <= 0) continue
    const product = products.find(p => p.id === line.productId)
    if (!product) return { ok: false, errors: [`Product not found: ${line.productName || line.productId}`] }

    if (line.requiresSerial) {
      for (const serialValue of line.serials) {
        const issueDesc = input.serialIssues?.[serialValue]?.trim() ?? ''
        const hasIssue = issueDesc.length > 0
        const barcode = buildInventoryBarcode({
          existingBarcodes: [...serials, ...newSerials].map(s => s.barcode),
          manufacturerSerial: serialValue,
          productSku: product.sku,
        })
        const newSerial: SerialNumber = {
          id: uid(),
          serial: serialValue,
          productId: line.productId,
          productName: line.productName,
          sku: product.sku,
          location: hasIssue ? 'warehouse' : input.destination,
          status: hasIssue ? 'refurbishment' : 'available',
          purchaseOrderId: po.id,
          receiptId: input.receiptId,
          receivedDate: date,
          barcode,
          accessories: input.serialAccessories?.[serialValue] ?? [],
          accessoryNotes: input.serialAccessoryNotes?.[serialValue],
          specs: input.serialSpecs?.[serialValue],
        }
        newSerials.push(newSerial)
        if (hasIssue) {
          refurbishmentJobs = [{
            id: uid(),
            ref: docSeq('REF'),
            status: 'queued',
            serialId: newSerial.id,
            serialNumber: serialValue,
            productId: line.productId,
            productName: line.productName,
            specs: input.serialSpecs?.[serialValue],
            receiptId: input.receiptId,
            receiptRef: receipt.ref,
            intakeDate: date,
            intakeIssueDescription: issueDesc,
            partsNeeded: [],
          }, ...refurbishmentJobs]
        }
      }
      products = products.map(p =>
        p.id === line.productId ? { ...p, stockQty: p.stockQty + line.serials.length } : p,
      )
      newMoves.push({
        id: uid(),
        type: 'in',
        productId: line.productId,
        productName: line.productName,
        qty: line.serials.length,
        reason: `Receipt ${receipt.ref}`,
        fromLocation: 'vendor',
        toLocation: input.destination,
        serialNumbers: line.serials,
        date,
        userId: input.actorUserId || 'system',
        documentRef: receipt.ref,
      })
    } else {
      bulkStock = upsertBulkStock(bulkStock, line.productId, input.destination, line.qtyReceived)
      products = products.map(p =>
        p.id === line.productId ? { ...p, stockQty: p.stockQty + line.qtyReceived } : p,
      )
      newMoves.push({
        id: uid(),
        type: 'in',
        productId: line.productId,
        productName: line.productName,
        qty: line.qtyReceived,
        reason: `Receipt ${receipt.ref}`,
        fromLocation: 'vendor',
        toLocation: input.destination,
        serialNumbers: [],
        date,
        userId: input.actorUserId || 'system',
        documentRef: receipt.ref,
      })
    }
  }

  serials = [...serials, ...newSerials]
  stockMoves = [...newMoves, ...stockMoves]

  const receivedByProduct = new Map(input.lines.map(line => [line.productId, line.qtyReceived]))
  const updatedPoLines = po.lines.map(line => {
    const receivedQty = receivedByProduct.get(line.productId)
    if (receivedQty === undefined) return line
    return { ...line, qtyReceived: Math.min(line.qty, line.qtyReceived + receivedQty) }
  })
  const allReceived = updatedPoLines.every(line => line.qtyReceived >= line.qty)
  const anyReceived = updatedPoLines.some(line => line.qtyReceived > 0)
  const hasOtherDraftReceipt = state.receipts.some(
    r => r.poId === receipt.poId && r.status === 'draft' && r.id !== input.receiptId,
  )
  const followUpLines = updatedPoLines
    .filter(line => line.qtyReceived < line.qty)
    .map(line => ({
      productId: line.productId,
      productName: line.productName,
      qtyExpected: line.qty - line.qtyReceived,
      qtyReceived: 0,
      serials: [] as string[],
      requiresSerial: line.requiresSerial,
      importedSerials: line.importedSerials?.slice(line.qtyReceived),
      specs: line.specs,
    }))

  const followUpReceipt: Receipt | null =
    !allReceived && anyReceived && !hasOtherDraftReceipt && followUpLines.length > 0
      ? {
          id: uid(),
          ref: docSeq('REC'),
          poId: receipt.poId,
          poRef: receipt.poRef,
          vendorId: receipt.vendorId,
          vendorName: receipt.vendorName,
          status: 'draft',
          date,
          lines: followUpLines,
          destinationLocation: input.destination,
        }
      : null

  let receipts = state.receipts.map(r =>
    r.id === input.receiptId
      ? {
          ...r,
          status: 'validated' as const,
          lines: input.lines,
          destinationLocation: input.destination,
        }
      : r,
  )
  if (followUpReceipt) receipts = [followUpReceipt, ...receipts]

  const purchaseOrders = state.purchaseOrders.map(order => {
    if (order.id !== receipt.poId) return order
    const receiptIds = order.receiptIds.includes(input.receiptId)
      ? order.receiptIds
      : [...order.receiptIds, input.receiptId]
    const nextReceiptIds =
      followUpReceipt && !receiptIds.includes(followUpReceipt.id)
        ? [...receiptIds, followUpReceipt.id]
        : receiptIds
    return {
      ...order,
      lines: updatedPoLines,
      status: allReceived ? ('received' as const) : anyReceived ? ('partial' as const) : order.status,
      receiptIds: nextReceiptIds,
    }
  })

  const auditLogs: AuditLog[] = [
    {
      id: uid(),
      date,
      user: input.actorUsername || 'system',
      action: 'validate_receipt',
      documentRef: receipt.ref,
      details: `Stock received from ${receipt.vendorName}${followUpReceipt ? ` · follow-up ${followUpReceipt.ref}` : ''}`,
    },
    ...state.auditLogs,
  ]

  return {
    ok: true,
    idempotent: false,
    followUpReceiptId: followUpReceipt?.id,
    message: followUpReceipt
      ? `Stock received · ${followUpReceipt.ref} created for remaining items`
      : `Stock received from ${receipt.vendorName}`,
    state: {
      receipts,
      purchaseOrders,
      serials,
      products,
      bulkStock,
      stockMoves,
      refurbishmentJobs,
      auditLogs,
    },
  }
}
