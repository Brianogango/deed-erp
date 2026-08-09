import 'server-only'
import { loadAppState } from '@/lib/server-store'
import {
  processOpeningStockValuation,
  processStockAdjustment,
  processStockCustomerReturn,
  processStockDelivery,
  processStockPosSale,
  processStockReceipt,
  processStockVendorReturn,
} from '@/lib/inventory/valuation-service'

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

export async function isAutomatedValuationEnabled(): Promise<boolean> {
  try {
    const state = await loadAppState(['deed_systemSettings'])
    const ss = state.deed_systemSettings as { invAutomatedValuation?: boolean } | null
    if (ss && typeof ss === 'object' && ss.invAutomatedValuation === false) return false
  } catch { /* default on */ }
  return true
}

function collectWarnings(results: any[]) {
  return results
    .filter((r: any) => r.error || r.result?.reason === 'product_not_in_prisma' || r.result?.skipped)
    .map((r: any) => r.error
      ? `${r.productId}: ${r.error}`
      : `${r.productId}: valuation skipped (${r.result?.reason || 'unknown'})`)
}

/**
 * After a GRN is validated, post weighted-average / FIFO / standard valuation (+ STK journal)
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

  return { ok: true as const, receiptRef: receipt.ref, results, warnings: collectWarnings(results) }
}

/**
 * After a delivery is validated (status done), reduce valuation and post COGS.
 */
export async function postDeliveryValuationFromPayload(params: {
  deliveryRef: string
  lines: Array<{ productId?: string; qtyDone?: number; qty?: number }>
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: false as const, reason: 'valuation_disabled', results: [] as any[], warnings: [] as string[] }
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
  return { ok: true as const, results, warnings: collectWarnings(results) }
}

export async function postPosValuationFromPayload(params: {
  orderRef: string
  lines: Array<{ productId?: string; qty?: number }>
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: false as const, reason: 'valuation_disabled', results: [] as any[], warnings: [] as string[] }
  }
  const results = []
  for (const line of params.lines || []) {
    const productId = String(line.productId || '').trim()
    if (!productId) continue
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue
    try {
      const result = await processStockPosSale({
        productId,
        qty,
        reference: params.orderRef,
        userId: params.userId,
        postJournal: true,
      })
      results.push({ productId, qty, result })
    } catch (err) {
      results.push({ productId, qty, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return { ok: true as const, results, warnings: collectWarnings(results) }
}

export async function postCustomerReturnValuation(params: {
  returnRef: string
  lines: Array<{ productId?: string; qty?: number }>
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: false as const, reason: 'valuation_disabled', results: [] as any[], warnings: [] as string[] }
  }
  const results = []
  for (const line of params.lines || []) {
    const productId = String(line.productId || '').trim()
    if (!productId) continue
    const qty = Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue
    try {
      const result = await processStockCustomerReturn({
        productId,
        qty,
        reference: params.returnRef,
        userId: params.userId,
        postJournal: true,
      })
      results.push({ productId, qty, result })
    } catch (err) {
      results.push({ productId, qty, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return { ok: true as const, results, warnings: collectWarnings(results) }
}

export async function postVendorReturnValuation(params: {
  returnRef: string
  lines: Array<{ productId?: string; qty?: number; serialIds?: string[]; requiresSerial?: boolean }>
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: false as const, reason: 'valuation_disabled', results: [] as any[], warnings: [] as string[] }
  }
  const results = []
  for (const line of params.lines || []) {
    const productId = String(line.productId || '').trim()
    if (!productId) continue
    const qty = line.requiresSerial
      ? (Array.isArray(line.serialIds) ? line.serialIds.length : 0)
      : Math.max(0, Math.floor(Number(line.qty) || 0))
    if (qty <= 0) continue
    try {
      const result = await processStockVendorReturn({
        productId,
        qty,
        reference: params.returnRef,
        userId: params.userId,
        postJournal: true,
      })
      results.push({ productId, qty, result })
    } catch (err) {
      results.push({ productId, qty, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return { ok: true as const, results, warnings: collectWarnings(results) }
}

export async function postAdjustmentValuation(params: {
  adjustmentRef: string
  productId: string
  type: 'add' | 'subtract'
  qty: number
  unitCost?: number
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: false as const, reason: 'valuation_disabled' }
  }
  try {
    const result = await processStockAdjustment({
      productId: params.productId,
      qty: params.qty,
      type: params.type,
      reference: params.adjustmentRef,
      userId: params.userId,
      unitCost: params.unitCost,
      postJournal: true,
    })
    return { ok: true as const, result }
  } catch (err) {
    return { ok: false as const, reason: err instanceof Error ? err.message : 'failed' }
  }
}

export async function postOpeningStockValuation(params: {
  items: Array<{ productId: string; qty: number; unitCost?: number }>
  reference?: string
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: false as const, reason: 'valuation_disabled', results: [] as any[] }
  }
  const results = []
  for (const item of params.items || []) {
    const productId = String(item.productId || '').trim()
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0))
    if (!productId || qty <= 0) continue
    try {
      const result = await processOpeningStockValuation({
        productId,
        qty,
        unitCost: Math.max(0, Number(item.unitCost) || 0),
        reference: params.reference || 'OPENING',
        userId: params.userId,
        postJournal: true,
      })
      results.push({ productId, qty, result })
    } catch (err) {
      results.push({ productId, qty, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return { ok: true as const, results, warnings: collectWarnings(results) }
}
