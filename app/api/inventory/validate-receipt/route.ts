import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/server'
import { hasPermission } from '@/lib/auth/authorization'
import { loadAppState, saveStoreKeys } from '@/lib/server-store'
import { applyReceiptValidation, type ApplyReceiptLine } from '@/lib/inventory/apply-receipt-validation'
import { appendInventoryAuditLog } from '@/lib/inventory/audit'
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
import type { BulkStockLevel } from '@/lib/business-logic'

export const dynamic = 'force-dynamic'

type Body = {
  receiptId?: string
  destination?: LocationId
  lines?: ApplyReceiptLine[]
  serialAccessories?: Record<string, string[]>
  serialAccessoryNotes?: Record<string, string>
  serialSpecs?: Record<string, string>
  serialIssues?: Record<string, string>
  /** When true (default), apply stock writes. When false, validate serials only. */
  apply?: boolean
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPermission(session.user, 'validatePurchaseReceipt')) {
    return NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 })
  }

  const body = await request.json().catch(() => null) as Body | null
  if (!body || !Array.isArray(body.lines)) {
    return NextResponse.json({ error: 'Expected body { lines: [...] }' }, { status: 400 })
  }

  const apply = body.apply !== false
  const state = await loadAppState([
    'deed_serials',
    'deed_receipts',
    'deed_purchaseOrders',
    'deed_products',
    'deed_bulkStock',
    'deed_stockMoves',
    'deed_refurbishmentJobs',
    'deed_auditLogs',
  ])

  const serials = asArray<SerialNumber>(state.deed_serials)

  // Validate-only mode (legacy / preflight without receiptId)
  if (!apply || !body.receiptId) {
    const { validateReceiptInput } = await import('@/lib/inventory-validation')
    const result = validateReceiptInput(body.lines, serials)
    if (!result.ok) return NextResponse.json(result, { status: 422 })
    return NextResponse.json(result)
  }

  if (!body.destination) {
    return NextResponse.json({ error: 'destination is required when apply=true' }, { status: 400 })
  }

  const result = applyReceiptValidation(
    {
      receipts: asArray<Receipt>(state.deed_receipts),
      purchaseOrders: asArray<PurchaseOrder>(state.deed_purchaseOrders),
      serials,
      products: asArray<Product>(state.deed_products),
      bulkStock: asArray<BulkStockLevel>(state.deed_bulkStock),
      stockMoves: asArray<StockMove>(state.deed_stockMoves),
      refurbishmentJobs: asArray<RefurbishmentJob>(state.deed_refurbishmentJobs),
      auditLogs: asArray<AuditLog>(state.deed_auditLogs),
    },
    {
      receiptId: body.receiptId,
      lines: body.lines,
      destination: body.destination,
      serialAccessories: body.serialAccessories,
      serialAccessoryNotes: body.serialAccessoryNotes,
      serialSpecs: body.serialSpecs,
      serialIssues: body.serialIssues,
      actorUserId: session.user.id,
      actorUsername: session.user.username || session.user.name,
    },
  )

  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 })
  }

  if (!result.idempotent) {
    try {
      await saveStoreKeys({
        deed_receipts: JSON.stringify(result.state.receipts),
        deed_purchaseOrders: JSON.stringify(result.state.purchaseOrders),
        deed_serials: JSON.stringify(result.state.serials),
        deed_products: JSON.stringify(result.state.products),
        deed_bulkStock: JSON.stringify(result.state.bulkStock),
        deed_stockMoves: JSON.stringify(result.state.stockMoves),
        deed_refurbishmentJobs: JSON.stringify(result.state.refurbishmentJobs),
        deed_auditLogs: JSON.stringify(result.state.auditLogs),
      }, { throwOnError: true })
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Failed to persist GRN stock writes' },
        { status: 500 },
      )
    }
    await appendInventoryAuditLog({
      action: 'validate_receipt',
      documentRef: body.receiptId,
      details: result.message,
      userId: session.user.id,
      username: session.user.username || session.user.name,
    })
  }

  return NextResponse.json({
    ok: true,
    idempotent: result.idempotent,
    message: result.message,
    followUpReceiptId: result.followUpReceiptId,
    state: {
      receipts: result.state.receipts,
      purchaseOrders: result.state.purchaseOrders,
      serials: result.state.serials,
      products: result.state.products,
      bulkStock: result.state.bulkStock,
      stockMoves: result.state.stockMoves,
      refurbishmentJobs: result.state.refurbishmentJobs,
    },
  })
}
