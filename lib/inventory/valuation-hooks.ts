import 'server-only'
import { loadAppState } from '@/lib/server-store'
import { processStockDelivery, processStockReceipt } from '@/lib/inventory/valuation-service'

type ReceiptLine = {
  productId?: string
  qtyReceived?: number
  requiresSerial?: boolean
  serials?: string[]
}

type PoLine = {
  productId?: string
  unitPrice?: number
  qty?: number
}

async function isAutomatedValuationEnabled(): Promise<boolean> {
  try {
    const state = await loadAppState(['deed_systemSettings'])
    const ss = state.deed_systemSettings as { invAutomatedValuation?: boolean } | null
    if (ss && typeof ss === 'object' && ss.invAutomatedValuation === false) return false
  } catch { /* default on */ }
  return true
}

/**
 * After a GRN is validated, post weighted-average valuation (+ STK journal)
 * using PO unit prices. Idempotent; never mutates app_state.
 */
export async function postReceiptValuationFromBlobs(params: {
  receiptId: string
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: false as const, reason: 'valuation_disabled', results: [] as any[] }
  }
  const state = await loadAppState(['deed_receipts', 'deed_purchaseOrders'])
  const receipts = Array.isArray(state.deed_receipts) ? state.deed_receipts as any[] : []
  const pos = Array.isArray(state.deed_purchaseOrders) ? state.deed_purchaseOrders as any[] : []
  const receipt = receipts.find(r => r?.id === params.receiptId)
  if (!receipt || receipt.status !== 'validated') {
    return { ok: false as const, reason: 'not_validated', results: [] as any[] }
  }
  const po = pos.find(p => p?.id === receipt.poId)
  const poLines: PoLine[] = Array.isArray(po?.lines) ? po.lines : []
  const lines: ReceiptLine[] = Array.isArray(receipt.lines) ? receipt.lines : []
  const results = []

  for (const line of lines) {
    const productId = String(line.productId || '').trim()
    if (!productId) continue
    const qty = line.requiresSerial
      ? (Array.isArray(line.serials) ? line.serials.length : 0)
      : Math.max(0, Math.floor(Number(line.qtyReceived) || 0))
    if (qty <= 0) continue
    const poLine = poLines.find(l => l.productId === productId)
    const unitCost = Math.max(0, Number(poLine?.unitPrice) || 0)
    try {
      const result = await processStockReceipt({
        productId,
        qty,
        unitCost,
        reference: String(receipt.ref || receipt.id),
        userId: params.userId,
        postJournal: true,
      })
      results.push({ productId, qty, unitCost, result })
    } catch (err) {
      results.push({ productId, qty, unitCost, error: err instanceof Error ? err.message : 'failed' })
    }
  }

  return { ok: true as const, receiptRef: receipt.ref, results }
}

/**
 * After a delivery is validated (status done), reduce valuation and post COGS.
 * Uses qtyDone on lines. Idempotent; never mutates app_state.
 */
export async function postDeliveryValuationFromPayload(params: {
  deliveryRef: string
  lines: Array<{ productId?: string; qtyDone?: number; qty?: number }>
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: false as const, reason: 'valuation_disabled', results: [] as any[] }
  }
  const results = []
  for (const line of params.lines || []) {
    const productId = String(line.productId || '').trim()
    if (!productId) continue
    const qty = Math.max(0, Math.floor(Number(line.qtyDone ?? line.qty) || 0))
    if (qty <= 0) continue
    try {
      const result = await processStockDelivery({
        productId,
        qty,
        reference: params.deliveryRef,
        userId: params.userId,
        postJournal: true,
      })
      results.push({ productId, qty, result })
    } catch (err) {
      results.push({ productId, qty, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return { ok: true as const, results }
}
