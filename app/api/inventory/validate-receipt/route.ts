import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/authorization'
import { loadAppState, loadAppStateForWrite, saveStoreKeys, withAppStateKeyLock } from '@/lib/server-store'
import { validateReceiptInput } from '@/lib/inventory-validation'
import { applyReceiptStockMutation, reverseReceiptStockMutation } from '@/lib/inventory/stock-transactions'
import { postReceiptValuationFromPayload } from '@/lib/inventory/valuation-hooks'

export const dynamic = 'force-dynamic'

type ReceiptLinePayload = {
  productId: string
  productName?: string
  qtyReceived: number
  requiresSerial: boolean
  serials?: string[]
  serialRecords?: Array<Record<string, unknown>>
}

/**
 * Validates GRN serial uniqueness. When `applyStock: true` (or destination
 * is provided with receiptRef), also applies authoritative stock mutation.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPermission(session.user, 'validatePurchaseReceipt')) {
    return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as {
    lines?: ReceiptLinePayload[]
    applyStock?: boolean
    destination?: string
    receiptId?: string
    receiptRef?: string
    purchaseOrderId?: string
    supplierInvoiceNo?: string
    notes?: string
  } | null
  if (!body || !Array.isArray(body.lines)) {
    return NextResponse.json({ error: 'Expected body { lines: [...] }' }, { status: 400 })
  }

  const state = await loadAppState(['deed_serials'])
  const existingSerials = Array.isArray(state.deed_serials) ? state.deed_serials as Array<{ serial?: string; barcode?: string }> : []
  const result = validateReceiptInput(body.lines, existingSerials)

  if (!result.ok) return NextResponse.json(result, { status: 422 })

  const shouldApplyStock = Boolean(body.applyStock || (body.destination && body.receiptRef))
  if (!shouldApplyStock) {
    return NextResponse.json(result)
  }

  const stock = await applyReceiptStockMutation({
    receiptId: String(body.receiptId || ''),
    receiptRef: String(body.receiptRef || 'REC'),
    purchaseOrderId: body.purchaseOrderId,
    destination: String(body.destination || 'warehouse'),
    supplierInvoiceNo: body.supplierInvoiceNo,
    notes: body.notes,
    lines: body.lines.map(line => ({
      productId: line.productId,
      productName: line.productName || '',
      qtyReceived: Number(line.qtyReceived || 0),
      requiresSerial: Boolean(line.requiresSerial),
      serials: line.serials,
      serialRecords: line.serialRecords,
    })),
    userId: session.user.id,
  })

  if (!stock.ok) {
    return NextResponse.json({ ok: false, errors: [stock.error], error: stock.error }, { status: 422 })
  }

  const receiptRef = String(body.receiptRef || 'REC')
  const destination = String(body.destination || 'warehouse')
  const poState = await loadAppState(['deed_purchaseOrders'])
  const pos = Array.isArray(poState.deed_purchaseOrders) ? poState.deed_purchaseOrders as any[] : []
  const po = pos.find(p => p?.id === body.purchaseOrderId)

  let valuation: unknown = null
  try {
    valuation = await postReceiptValuationFromPayload({
      receiptRef,
      lines: body.lines.map(line => ({
        productId: line.productId,
        qtyReceived: Number(line.qtyReceived || 0),
        requiresSerial: Boolean(line.requiresSerial),
        serials: line.serials,
      })),
      poLines: Array.isArray(po?.lines) ? po.lines : [],
      userId: session.user.id,
    })
  } catch (err) {
    await reverseReceiptStockMutation({
      receiptRef,
      destination,
      lines: body.lines.map(line => ({
        productId: line.productId,
        qtyReceived: Number(line.qtyReceived || 0),
        requiresSerial: Boolean(line.requiresSerial),
        serials: line.serials,
      })),
    })
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Receipt valuation failed' },
      { status: 422 },
    )
  }
  if (valuation && typeof valuation === 'object' && 'ok' in valuation && !(valuation as { ok?: boolean }).ok) {
    await reverseReceiptStockMutation({
      receiptRef,
      destination,
      lines: body.lines.map(line => ({
        productId: line.productId,
        qtyReceived: Number(line.qtyReceived || 0),
        requiresSerial: Boolean(line.requiresSerial),
        serials: line.serials,
      })),
    })
    return NextResponse.json(
      { ok: false, error: `Receipt valuation failed: ${(valuation as { reason?: string }).reason || 'unknown'}`, valuation },
      { status: 422 },
    )
  }

  // Persist the operational document state before reporting success. Previously
  // the browser performed these writes after this endpoint returned, so a lost
  // request or optimistic-lock conflict could leave stock received while the
  // GRN still appeared as draft and the PO still appeared unreceived.
  const finalized = await withAppStateKeyLock('deed_receipts', async () => {
    const documentState = await loadAppStateForWrite(['deed_receipts', 'deed_purchaseOrders'])
    const receipts = Array.isArray(documentState.deed_receipts) ? [...documentState.deed_receipts] as any[] : []
    const purchaseOrders = Array.isArray(documentState.deed_purchaseOrders) ? [...documentState.deed_purchaseOrders] as any[] : []
    const receiptIndex = receipts.findIndex(item => item?.id === body.receiptId)
    if (receiptIndex < 0) {
      throw new Error('Receipt no longer exists. Refresh Purchase and try again.')
    }

    const currentReceipt = receipts[receiptIndex]
    if (currentReceipt.status !== 'draft' && currentReceipt.status !== 'validated') {
      throw new Error(`Receipt ${currentReceipt.ref || body.receiptRef || ''} cannot be validated from status ${currentReceipt.status}`)
    }
    receipts[receiptIndex] = {
      ...currentReceipt,
      status: 'validated',
      lines: body.lines,
      destinationLocation: destination,
      validatedAt: new Date().toISOString(),
      validatedBy: session.user.id,
    }

    const poIndex = purchaseOrders.findIndex(item => item?.id === body.purchaseOrderId)
    if (poIndex >= 0) {
      const currentPo = purchaseOrders[poIndex]
      const receivedByProduct = new Map<string, number>()
      for (const line of body.lines) {
        const productId = String(line.productId || '')
        receivedByProduct.set(productId, (receivedByProduct.get(productId) || 0) + Math.max(0, Number(line.qtyReceived) || 0))
      }
      const poLines = (Array.isArray(currentPo.lines) ? currentPo.lines : []).map((line: any) => {
        const added = receivedByProduct.get(String(line.productId || '')) || 0
        return added > 0
          ? { ...line, qtyReceived: Math.min(Number(line.qty) || 0, (Number(line.qtyReceived) || 0) + added) }
          : line
      })
      const allReceived = poLines.length > 0 && poLines.every((line: any) => Number(line.qtyReceived) >= Number(line.qty))
      const anyReceived = poLines.some((line: any) => Number(line.qtyReceived) > 0)
      const receiptIds = Array.isArray(currentPo.receiptIds) ? currentPo.receiptIds : []
      purchaseOrders[poIndex] = {
        ...currentPo,
        lines: poLines,
        status: allReceived ? 'received' : anyReceived ? 'partial' : currentPo.status,
        receiptIds: receiptIds.includes(body.receiptId) ? receiptIds : [...receiptIds, body.receiptId],
      }
    }

    await saveStoreKeys({
      deed_receipts: JSON.stringify(receipts),
      deed_purchaseOrders: JSON.stringify(purchaseOrders),
    })
    return {
      receipt: receipts[receiptIndex],
      purchaseOrder: poIndex >= 0 ? purchaseOrders[poIndex] : null,
    }
  })

  return NextResponse.json({
    ...result,
    stockApplied: true,
    moves: stock.moves,
    valuation,
    finalized,
    message: `${receiptRef} validated successfully. Stock and purchase progress were updated.`,
  })
}
