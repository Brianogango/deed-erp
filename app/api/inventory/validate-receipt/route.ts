import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/authorization'
import { loadAppState } from '@/lib/server-store'
import { validateReceiptInput } from '@/lib/inventory-validation'
import { applyReceiptStockMutation } from '@/lib/inventory/stock-transactions'

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

  return NextResponse.json({ ...result, stockApplied: true, moves: stock.moves })
}
