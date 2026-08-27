/**
 * Relational three-way matching for vendor-bill posting.
 * Matching and qtyBilled reservation must execute inside the same SERIALIZABLE
 * transaction that creates the bill journal.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

export type VendorBillMatchLine = {
  purchaseOrderItemId?: string | null
  grnItemId?: string | null
  productId?: string | null
  qty: number
  unitPrice?: number
  taxRate?: number
  description?: string
}

export type AssertVendorBillMatchInput = {
  purchaseOrderId: string
  vendorId?: string | null
  billLines: VendorBillMatchLine[]
  priceTolerance?: number
  taxTolerance?: number
}

const n = (v: unknown) => Number(v) || 0
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

export async function assertVendorBillThreeWayMatchInTx(
  tx: Prisma.TransactionClient,
  input: AssertVendorBillMatchInput,
): Promise<{ ok: true; poRef: string; reservations: Array<{ poItemId: string; qty: number }> }> {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: input.purchaseOrderId },
    include: { items: true },
  })
  if (!po) {
    const err = new Error(`Purchase order not found: ${input.purchaseOrderId}`)
    ;(err as Error & { status?: number }).status = 404
    throw err
  }
  if (input.vendorId && po.clientId && input.vendorId !== po.clientId) {
    throw new Error(`Vendor mismatch: bill vendor does not match PO ${po.poNumber}`)
  }

  const priceTolerance = Math.max(0, input.priceTolerance ?? 0.01)
  const taxTolerance = Math.max(0, input.taxTolerance ?? 0.001)
  const byId = new Map(po.items.map(line => [line.id, line]))
  const productMultiplicity = new Map<string, number>()
  for (const line of po.items) {
    productMultiplicity.set(line.productId, (productMultiplicity.get(line.productId) || 0) + 1)
  }

  const requested = new Map<string, { qty: number; line: VendorBillMatchLine }>()
  for (const bill of input.billLines) {
    const qty = n(bill.qty)
    if (qty <= 0) throw new Error(`Vendor bill line must have a positive quantity: ${bill.description || 'line'}`)

    let poItem = bill.purchaseOrderItemId ? byId.get(bill.purchaseOrderItemId) : undefined
    if (!poItem && bill.productId) {
      if ((productMultiplicity.get(bill.productId) || 0) > 1) {
        throw new Error(`PO ${po.poNumber} contains product ${bill.productId} on multiple lines; purchaseOrderItemId is required`)
      }
      poItem = po.items.find(line => line.productId === bill.productId)
    }
    if (!poItem) {
      throw new Error(`Every vendor bill line must reference a valid purchase-order line: ${bill.description || bill.productId || 'line'}`)
    }
    if (bill.productId && bill.productId !== poItem.productId) {
      throw new Error(`Bill product does not match PO line ${poItem.id}`)
    }
    if (bill.unitPrice != null && !close(n(bill.unitPrice), n(poItem.unitCost), priceTolerance)) {
      throw new Error(`Price mismatch on PO ${po.poNumber}: billed ${n(bill.unitPrice)} vs ordered ${n(poItem.unitCost)}`)
    }
    if (bill.taxRate != null && !close(n(bill.taxRate), n(poItem.taxRate), taxTolerance)) {
      throw new Error(`Tax mismatch on PO ${po.poNumber}: billed ${n(bill.taxRate)} vs ordered ${n(poItem.taxRate)}`)
    }
    if (bill.grnItemId) {
      const grn = await tx.grnItem.findUnique({ where: { id: bill.grnItemId } })
      if (!grn || grn.poItemId !== poItem.id) {
        throw new Error(`Receipt line ${bill.grnItemId} does not belong to PO line ${poItem.id}`)
      }
    }

    const prior = requested.get(poItem.id)
    requested.set(poItem.id, { qty: n(prior?.qty) + qty, line: bill })
  }

  const reservations: Array<{ poItemId: string; qty: number }> = []
  for (const [poItemId, req] of requested) {
    const poItem = byId.get(poItemId)!
    const remaining = n(poItem.qtyReceived) - n(poItem.qtyBilled)
    if (req.qty > remaining + 1e-9) {
      throw new Error(
        `3-way match failed for PO ${po.poNumber}: bill requests ${req.qty}, but only ${remaining} received and unbilled on line ${poItemId}`,
      )
    }

    // Compare-and-swap prevents two concurrent bills from consuming the same
    // received quantity even before SERIALIZABLE conflict detection.
    const claimed = await tx.purchaseOrderItem.updateMany({
      where: { id: poItemId, qtyBilled: poItem.qtyBilled },
      data: { qtyBilled: { increment: Math.trunc(req.qty) } },
    })
    if (claimed.count !== 1) {
      throw new Error(`PO ${po.poNumber} billing quantity changed concurrently; retry the bill posting.`)
    }
    reservations.push({ poItemId, qty: req.qty })
  }

  return { ok: true, poRef: po.poNumber, reservations }
}

/**
 * Read-only preflight retained for UI/API validation. The authoritative gate is
 * assertVendorBillThreeWayMatchInTx during posting.
 */
export async function assertVendorBillThreeWayMatchServer(
  input: AssertVendorBillMatchInput,
): Promise<{ ok: true; poRef: string }> {
  const result = await prisma.$transaction(async tx => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      include: { items: true },
    })
    if (!po) throw new Error(`Purchase order not found: ${input.purchaseOrderId}`)
    if (input.vendorId && po.clientId && input.vendorId !== po.clientId) {
      throw new Error(`Vendor mismatch: bill vendor does not match PO ${po.poNumber}`)
    }
    for (const bill of input.billLines) {
      const poItem = bill.purchaseOrderItemId
        ? po.items.find(x => x.id === bill.purchaseOrderItemId)
        : po.items.find(x => x.productId === bill.productId)
      if (!poItem) throw new Error('Vendor bill line is not linked to a purchase-order line')
      const remaining = n(poItem.qtyReceived) - n(poItem.qtyBilled)
      if (n(bill.qty) <= 0 || n(bill.qty) > remaining) {
        throw new Error(`3-way match failed: quantity ${n(bill.qty)} exceeds received/unbilled ${remaining}`)
      }
    }
    return { ok: true as const, poRef: po.poNumber }
  })
  return result
}
