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
  reversePosSaleValuation,
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

/** Chart / journal / analytic setup gaps must not reverse POS or delivery stock. */
export function isFinanceSetupGap(message: string | null | undefined): boolean {
  const value = String(message || '')
  return /Unknown journal code/i.test(value)
    || /Unknown account/i.test(value)
    || /Inactive account/i.test(value)
    || /Unknown analytic account/i.test(value)
    || /Inactive analytic account/i.test(value)
    || /Journal account must start with a valid account code/i.test(value)
    || /analytic_account_id/i.test(value)
    || /does not exist in the current database/i.test(value)
}

function isSoftSkip(result: any, opts?: { allowMissingProduct?: boolean; allowFinanceSetupGap?: boolean }) {
  if (result?.skipped && result?.reason === 'already_processed') return true
  if (opts?.allowMissingProduct && result?.skipped && result?.reason === 'product_not_in_prisma') return true
  if (result?.skipped && result?.reason === 'non_stock') return true
  if (opts?.allowFinanceSetupGap && isFinanceSetupGap(result?.reason)) return true
  return false
}

function isHardValuationLine(result: any, opts?: { allowMissingProduct?: boolean; allowFinanceSetupGap?: boolean }) {
  if (result?.error) {
    if (opts?.allowFinanceSetupGap && isFinanceSetupGap(result.error)) return false
    return true
  }
  return Boolean(result?.result?.skipped && !isSoftSkip(result.result, opts))
}

/** Fail-closed: any hard line error or non-idempotent skip blocks the operational document. */
export function finalizeValuation(results: any[], opts?: { allowMissingProduct?: boolean; allowFinanceSetupGap?: boolean }) {
  const warnings = collectWarnings(results)
  const hard = results.filter((r: any) => isHardValuationLine(r, opts))
  if (hard.length > 0) {
    const reason = hard
      .map(r => String(r.error || r.result?.reason || 'valuation_failed'))
      .join('; ')
    return {
      ok: false as const,
      reason,
      results,
      warnings,
    }
  }
  return { ok: true as const, results, warnings }
}

/**
 * After a GRN is validated, post weighted-average / FIFO / standard valuation (+ STK journal)
 * using PO unit prices. Idempotent; never mutates app_state.
 */
export async function postReceiptValuationFromPayload(params: {
  receiptRef: string
  lines: ReceiptLine[]
  poLines?: PoLine[]
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: true as const, reason: 'valuation_disabled', results: [] as any[], warnings: [] as string[] }
  }
  const poLines = Array.isArray(params.poLines) ? params.poLines : []
  const results = []
  for (const line of params.lines || []) {
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
        reference: params.receiptRef,
        userId: params.userId,
        postJournal: true,
      })
      results.push({ productId, qty, unitCost, result })
    } catch (err) {
      results.push({ productId, qty, unitCost, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return { ...finalizeValuation(results), receiptRef: params.receiptRef }
}

/**
 * After a GRN is validated, post weighted-average / FIFO / standard valuation (+ STK journal)
 * using PO unit prices. Idempotent; never mutates app_state.
 * Does not require the blob to already be marked validated — callers persist that only after success.
 */
export async function postReceiptValuationFromBlobs(params: {
  receiptId: string
  userId?: string
  receipt?: { id?: string; ref?: string; poId?: string; lines?: ReceiptLine[] }
}) {
  const state = await loadAppState(['deed_receipts', 'deed_purchaseOrders'])
  const receipts = Array.isArray(state.deed_receipts) ? state.deed_receipts as any[] : []
  const pos = Array.isArray(state.deed_purchaseOrders) ? state.deed_purchaseOrders as any[] : []
  const receipt = params.receipt || receipts.find(r => r?.id === params.receiptId)
  if (!receipt) {
    return { ok: false as const, reason: 'not_found', results: [] as any[], warnings: [] as string[] }
  }
  const po = pos.find(p => p?.id === receipt.poId)
  return postReceiptValuationFromPayload({
    receiptRef: String(receipt.ref || receipt.id || params.receiptId),
    lines: Array.isArray(receipt.lines) ? receipt.lines : [],
    poLines: Array.isArray(po?.lines) ? po.lines : [],
    userId: params.userId,
  })
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
    return { ok: true as const, reason: 'valuation_disabled', results: [] as any[], warnings: [] as string[] }
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
  // Legacy blob-only products and incomplete finance setup (missing STK
  // journal, inactive CoA row after a chart edit) are bookkeeping gaps —
  // not a reason to reverse warehouse stock or block the delivery note.
  return finalizeValuation(results, { allowMissingProduct: true, allowFinanceSetupGap: true })
}

export async function postPosValuationFromPayload(params: {
  orderRef: string
  lines: Array<{ productId?: string; qty?: number }>
  userId?: string
}) {
  if (!(await isAutomatedValuationEnabled())) {
    return { ok: true as const, reason: 'valuation_disabled', results: [] as any[], warnings: [] as string[] }
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
  return finalizeValuation(results, { allowMissingProduct: true, allowFinanceSetupGap: true })
}
export async function reversePosValuationFromPayload(params: {
  orderRef: string
  lines: Array<{ productId?: string; qty?: number }>
  userId?: string
}) {
  const results = []
  for (const line of params.lines || []) {
    const productId = String(line.productId || '').trim()
    if (!productId) continue
    try {
      const result = await reversePosSaleValuation({
        productId,
        qty: Math.max(0, Math.floor(Number(line.qty) || 0)),
        reference: params.orderRef,
        userId: params.userId,
      })
      results.push({ productId, result })
    } catch (err) {
      results.push({ productId, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  return { ok: true as const, results }
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
