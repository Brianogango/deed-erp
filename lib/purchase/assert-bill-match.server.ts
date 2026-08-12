/**
 * Server-side 3-way match gate for vendor bill posting (Finance Phase 3).
 * Loads blob PO (blob_sot) and asserts billable qty before the bill is posted.
 */

import 'server-only'
import { loadAppState } from '@/lib/server-store'
import {
  assertVendorBillThreeWayMatch,
  type ThreeWayPoLine,
  type VendorBillLineForMatch,
} from '@/lib/purchase/three-way-match'

export type AssertVendorBillMatchInput = {
  purchaseOrderId: string
  billLines: VendorBillLineForMatch[]
  /** When true, skip if PO cannot be found (log-friendly soft path). Default false = hard fail. */
  allowMissingPo?: boolean
}

/**
 * Throws Error with status 409 when bill qty exceeds received − billed on the PO.
 */
export async function assertVendorBillThreeWayMatchServer(
  input: AssertVendorBillMatchInput,
): Promise<{ ok: true; poRef?: string } | { ok: false; skipped: true; reason: string }> {
  const state = await loadAppState(['deed_purchaseOrders'])
  const pos = Array.isArray(state.deed_purchaseOrders) ? state.deed_purchaseOrders as any[] : []
  const po = pos.find(p => p?.id === input.purchaseOrderId)
  if (!po) {
    if (input.allowMissingPo) {
      return { ok: false, skipped: true, reason: `PO ${input.purchaseOrderId} not in blob store` }
    }
    const err = new Error(`Purchase order not found for 3-way match: ${input.purchaseOrderId}`)
    ;(err as Error & { status?: number }).status = 404
    throw err
  }

  const poLines: ThreeWayPoLine[] = (Array.isArray(po.lines) ? po.lines : []).map((l: any) => ({
    productId: l?.productId,
    qtyOrdered: Number(l?.qtyOrdered ?? l?.qty) || 0,
    qty: Number(l?.qty) || 0,
    qtyReceived: Number(l?.qtyReceived) || 0,
    qtyBilled: Number(l?.qtyBilled) || 0,
  }))

  try {
    assertVendorBillThreeWayMatch({
      poLines,
      billLines: input.billLines,
    })
  } catch (err: any) {
    const e = new Error(String(err?.message || err))
    ;(e as Error & { status?: number }).status = 409
    throw e
  }

  return { ok: true, poRef: String(po.ref || po.id) }
}
