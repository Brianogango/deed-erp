import { describe, expect, it } from 'vitest'
import { applyReceiptValidation } from '@/lib/inventory/apply-receipt-validation'
import { buildVendorLedgerRows } from '@/lib/inventory/vendor-ledger'
import type { Product, PurchaseOrder, Receipt, SerialNumber } from '@/lib/store'

const product: Product = {
  id: 'p1', name: 'Laptop', sku: 'LP-1', barcode: '', category: 'Laptops',
  salePrice: 100, costPrice: 50, taxRate: 16, stockQty: 0, minStock: 1,
  unit: 'unit', description: '', canBeSold: true, canBePurchased: true,
  image: '', isActive: true, warrantyMonths: 12, requiresSerial: true,
  trackingMethod: 'SERIAL',
}

const po: PurchaseOrder = {
  id: 'po1', ref: 'PO/1', vendorId: 'v1', vendorName: 'Vendor A',
  status: 'confirmed', date: '2026-07-01', expectedDate: '2026-07-10',
  lines: [{
    id: 'pol1', productId: 'p1', productName: 'Laptop',
    qty: 2, qtyReceived: 0, unitPrice: 50, taxRate: 16, subtotal: 100,
    requiresSerial: true,
  }],
  receiptIds: ['r1'], notes: '',
  subtotal: 100, taxTotal: 16, total: 116,
}

const receipt: Receipt = {
  id: 'r1', ref: 'REC/1', poId: 'po1', poRef: 'PO/1',
  vendorId: 'v1', vendorName: 'Vendor A', status: 'draft', date: '2026-07-10',
  lines: [{
    productId: 'p1', productName: 'Laptop', qtyExpected: 2, qtyReceived: 2,
    serials: ['SN-A', 'SN-B'], requiresSerial: true,
  }],
  destinationLocation: 'warehouse',
}

describe('applyReceiptValidation', () => {
  it('applies stock writes and is idempotent on re-run', () => {
    const first = applyReceiptValidation(
      {
        receipts: [receipt],
        purchaseOrders: [po],
        serials: [],
        products: [product],
        bulkStock: [],
        stockMoves: [],
        refurbishmentJobs: [],
        auditLogs: [],
      },
      {
        receiptId: 'r1',
        destination: 'warehouse',
        lines: receipt.lines,
        actorUserId: 'u1',
        actorUsername: 'admin',
        nowIsoDate: '2026-07-10',
      },
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.idempotent).toBe(false)
    expect(first.state.serials).toHaveLength(2)
    expect(first.state.receipts[0].status).toBe('validated')
    expect(first.state.products[0].stockQty).toBe(2)
    expect(first.state.stockMoves).toHaveLength(1)

    const second = applyReceiptValidation(first.state, {
      receiptId: 'r1',
      destination: 'warehouse',
      lines: receipt.lines,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.idempotent).toBe(true)
    expect(second.state.serials).toHaveLength(2)
  })

  it('rejects missing serials', () => {
    const result = applyReceiptValidation(
      {
        receipts: [receipt],
        purchaseOrders: [po],
        serials: [],
        products: [product],
        bulkStock: [],
        stockMoves: [],
        refurbishmentJobs: [],
        auditLogs: [],
      },
      {
        receiptId: 'r1',
        destination: 'warehouse',
        lines: [{ ...receipt.lines[0], serials: ['SN-A'], qtyReceived: 2 }],
      },
    )
    expect(result.ok).toBe(false)
  })
})

describe('vendor ledger return status', () => {
  it('marks returned serials and sold serials', () => {
    const serials: SerialNumber[] = [
      {
        id: 's1', serial: 'SN-1', productId: 'p1', productName: 'Laptop', sku: 'LP-1',
        location: 'warehouse', status: 'available', purchaseOrderId: 'po1', receiptId: 'r1',
        receivedDate: '2026-07-01', barcode: 'INV-1',
      },
      {
        id: 's2', serial: 'SN-2', productId: 'p1', productName: 'Laptop', sku: 'LP-1',
        location: 'customer', status: 'sold', purchaseOrderId: 'po1', receiptId: 'r1',
        receivedDate: '2026-07-01', soldDate: '2026-07-15', saleOrderId: 'so1', barcode: 'INV-2',
      },
      {
        id: 's3', serial: 'SN-3', productId: 'p1', productName: 'Laptop', sku: 'LP-1',
        location: 'warehouse', status: 'returned', purchaseOrderId: 'po1', receiptId: 'r1',
        receivedDate: '2026-07-01', soldDate: '2026-07-12', saleOrderId: 'so2', barcode: 'INV-3',
      },
    ]

    const { rows, summary } = buildVendorLedgerRows({
      vendorId: 'v1',
      serials,
      receipts: [{
        id: 'r1', ref: 'REC/1', vendorId: 'v1', vendorName: 'Vendor A', status: 'validated',
        date: '2026-07-01', poId: 'po1', poRef: 'PO/1',
        lines: [{ productId: 'p1', productName: 'Laptop', qtyReceived: 3, requiresSerial: true }],
      }],
      purchaseOrders: [{ id: 'po1', ref: 'PO/1', vendorId: 'v1' }],
      products: [product],
      customerReturns: [{
        id: 'rma1', ref: 'RMA/1', saleOrderId: 'so2', saleOrderRef: 'SO/2',
        customerId: 'c1', customerName: 'Client', status: 'processed',
        requestDate: '2026-07-20', reason: 'defective',
        lines: [{ id: 'l1', productId: 'p1', productName: 'Laptop', qty: 1, serialIds: ['s3'], condition: 'defective', reason: 'dead on arrival' }],
        receivedDate: '2026-07-21',
      }],
      vendorReturns: [],
    })

    expect(rows).toHaveLength(3)
    expect(rows.find(r => r.serial === 'SN-2')?.salesStatus).toBe('Sold')
    expect(rows.find(r => r.serial === 'SN-3')?.returnStatus).toBe('Returned to Stock')
    expect(summary.unitsSold).toBe(1)
    expect(summary.unitsReturned).toBeGreaterThanOrEqual(1)
  })
})
