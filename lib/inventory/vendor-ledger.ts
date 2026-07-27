import type { LocationId, PurchaseReturn, ReturnOrder, SerialNumber } from '@/lib/store'

export type VendorLedgerSoldFilter =
  | 'all'
  | 'not_sold'
  | 'sold'
  | 'sold_and_returned'
  | 'returned_to_stock'
  | 'returned_to_vendor'
  | 'scrapped'

export type VendorLedgerRow = {
  id: string
  kind: 'serial' | 'quantity'
  productId: string
  productName: string
  sku: string
  serial?: string
  lotOrLayer?: string
  vendorId: string
  vendorName: string
  purchaseOrderId?: string
  purchaseOrderRef?: string
  receiptId?: string
  receiptRef?: string
  receivedDate?: string
  warehouse: string
  location?: LocationId
  quantityPurchased: number
  quantityRemaining: number
  inventoryStatus: string
  salesStatus: 'Not Sold' | 'Sold' | 'Reserved'
  returnStatus: string
  returnDate?: string
  returnRef?: string
  returnReason?: string
  saleOrderId?: string
  soldDate?: string
  customerName?: string
  daysInStock?: number
}

export type VendorLedgerSummary = {
  unitsReceived: number
  unitsSold: number
  unitsInStock: number
  unitsReturned: number
  serialisedUnits: number
  quantityTrackedUnits: number
}

function daysBetween(from?: string, to = new Date().toISOString().slice(0, 10)) {
  if (!from) return undefined
  const a = new Date(`${from.slice(0, 10)}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return undefined
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000))
}

function serialSalesStatus(serial: SerialNumber): VendorLedgerRow['salesStatus'] {
  if (serial.status === 'sold') return 'Sold'
  if (serial.status === 'assigned') return 'Reserved'
  return 'Not Sold'
}

function serialReturnStatus(
  serial: SerialNumber,
  customerReturns: ReturnOrder[],
  vendorReturns: PurchaseReturn[],
): { status: string; date?: string; ref?: string; reason?: string } {
  const customerReturn = customerReturns.find(r =>
    ['received', 'processed'].includes(r.status) &&
    r.lines.some(line => line.serialIds.includes(serial.id)),
  )
  const vendorReturn = vendorReturns.find(r =>
    r.status === 'confirmed' &&
    r.lines.some(line => line.serialIds.includes(serial.id)),
  )

  if (vendorReturn) {
    return {
      status: 'Returned to Vendor',
      date: vendorReturn.date,
      ref: vendorReturn.ref,
      reason: vendorReturn.reason,
    }
  }
  if (serial.status === 'written_off') {
    return { status: 'Scrapped' }
  }
  if (customerReturn) {
    const line = customerReturn.lines.find(l => l.serialIds.includes(serial.id))
    if (serial.status === 'returned' || serial.location === 'warehouse') {
      return {
        status: 'Returned to Stock',
        date: customerReturn.receivedDate || customerReturn.processedDate || customerReturn.requestDate,
        ref: customerReturn.ref,
        reason: line?.reason || customerReturn.reason,
      }
    }
    return {
      status: 'Sold and Returned',
      date: customerReturn.receivedDate || customerReturn.requestDate,
      ref: customerReturn.ref,
      reason: line?.reason || customerReturn.reason,
    }
  }
  if (serial.status === 'returned') {
    return { status: 'Returned to Stock', date: undefined }
  }
  return { status: 'Not Returned' }
}

export function buildVendorLedgerRows(args: {
  vendorId: string
  serials: SerialNumber[]
  receipts: Array<{
    id: string
    ref: string
    vendorId: string
    vendorName: string
    status: string
    date: string
    poId: string
    poRef: string
    lines: Array<{ productId: string; productName: string; qtyReceived: number; requiresSerial: boolean }>
  }>
  purchaseOrders: Array<{ id: string; ref: string; vendorId: string }>
  products: Array<{ id: string; name: string; sku: string }>
  customerReturns: ReturnOrder[]
  vendorReturns: PurchaseReturn[]
  warehouse?: LocationId | 'all'
  soldFilter?: VendorLedgerSoldFilter
  search?: string
}): { rows: VendorLedgerRow[]; summary: VendorLedgerSummary } {
  const productMap = new Map(args.products.map(p => [p.id, p]))
  const rows: VendorLedgerRow[] = []

  const validatedReceipts = args.receipts.filter(
    r => r.vendorId === args.vendorId && r.status === 'validated',
  )

  for (const receipt of validatedReceipts) {
    for (const line of receipt.lines) {
      if (line.qtyReceived <= 0) continue
      const product = productMap.get(line.productId)

      if (line.requiresSerial) {
        const lineSerials = args.serials.filter(s =>
          s.productId === line.productId && s.receiptId === receipt.id,
        )
        for (const serial of lineSerials) {
          if (args.warehouse && args.warehouse !== 'all' && serial.location !== args.warehouse) continue
          const ret = serialReturnStatus(serial, args.customerReturns, args.vendorReturns)
          const salesStatus = serialSalesStatus(serial)
          const remaining = ['available', 'assigned', 'under_repair', 'refurbishment', 'in_stock', 'returned'].includes(serial.status)
            && serial.location !== 'customer' && serial.location !== 'vendor'
            ? 1
            : 0
          rows.push({
            id: `serial-${serial.id}`,
            kind: 'serial',
            productId: line.productId,
            productName: serial.productName || product?.name || line.productName,
            sku: serial.sku || product?.sku || '',
            serial: serial.serial,
            vendorId: receipt.vendorId,
            vendorName: receipt.vendorName,
            purchaseOrderId: receipt.poId,
            purchaseOrderRef: receipt.poRef,
            receiptId: receipt.id,
            receiptRef: receipt.ref,
            receivedDate: serial.receivedDate || receipt.date,
            warehouse: serial.location,
            location: serial.location,
            quantityPurchased: 1,
            quantityRemaining: remaining,
            inventoryStatus: serial.status,
            salesStatus,
            returnStatus: ret.status,
            returnDate: ret.date,
            returnRef: ret.ref,
            returnReason: ret.reason,
            saleOrderId: serial.saleOrderId,
            soldDate: serial.soldDate,
            daysInStock: daysBetween(serial.receivedDate || receipt.date),
          })
        }
      } else {
        // Quantity-tracked: one ledger row per receipt line (no fabricated sale allocation)
        const inStockHint = Math.max(0, line.qtyReceived) // remaining unknown without layers — show received as purchased
        rows.push({
          id: `qty-${receipt.id}-${line.productId}`,
          kind: 'quantity',
          productId: line.productId,
          productName: product?.name || line.productName,
          sku: product?.sku || '',
          lotOrLayer: receipt.ref,
          vendorId: receipt.vendorId,
          vendorName: receipt.vendorName,
          purchaseOrderId: receipt.poId,
          purchaseOrderRef: receipt.poRef,
          receiptId: receipt.id,
          receiptRef: receipt.ref,
          receivedDate: receipt.date,
          warehouse: args.warehouse === 'all' || !args.warehouse ? 'all' : args.warehouse,
          quantityPurchased: line.qtyReceived,
          quantityRemaining: inStockHint,
          inventoryStatus: 'quantity_layer',
          salesStatus: 'Not Sold',
          returnStatus: 'Not Returned',
          daysInStock: daysBetween(receipt.date),
        })
      }
    }
  }

  // Vendor returns without serial linkage still show as quantity returns against receipt
  for (const vr of args.vendorReturns) {
    if (vr.vendorId !== args.vendorId || vr.status !== 'confirmed') continue
    for (const line of vr.lines) {
      if (line.requiresSerial) continue
      rows.push({
        id: `vret-${vr.id}-${line.productId}`,
        kind: 'quantity',
        productId: line.productId,
        productName: line.productName,
        sku: productMap.get(line.productId)?.sku || '',
        vendorId: vr.vendorId,
        vendorName: vr.vendorName,
        purchaseOrderId: vr.poId,
        purchaseOrderRef: vr.poRef,
        receiptId: vr.receiptId,
        receiptRef: vr.receiptRef,
        receivedDate: undefined,
        warehouse: 'vendor',
        quantityPurchased: 0,
        quantityRemaining: 0,
        inventoryStatus: 'returned_to_vendor',
        salesStatus: 'Not Sold',
        returnStatus: 'Returned to Vendor',
        returnDate: vr.date,
        returnRef: vr.ref,
        returnReason: vr.reason,
      })
    }
  }

  const q = (args.search || '').trim().toLowerCase()
  let filtered = rows
  if (q) {
    filtered = filtered.filter(row =>
      row.productName.toLowerCase().includes(q) ||
      row.sku.toLowerCase().includes(q) ||
      (row.serial || '').toLowerCase().includes(q) ||
      (row.receiptRef || '').toLowerCase().includes(q) ||
      (row.purchaseOrderRef || '').toLowerCase().includes(q),
    )
  }

  switch (args.soldFilter || 'all') {
    case 'not_sold':
      filtered = filtered.filter(r => r.salesStatus === 'Not Sold' && r.returnStatus === 'Not Returned')
      break
    case 'sold':
      filtered = filtered.filter(r => r.salesStatus === 'Sold')
      break
    case 'sold_and_returned':
      filtered = filtered.filter(r => r.returnStatus === 'Sold and Returned' || r.returnStatus === 'Returned to Stock')
      break
    case 'returned_to_stock':
      filtered = filtered.filter(r => r.returnStatus === 'Returned to Stock')
      break
    case 'returned_to_vendor':
      filtered = filtered.filter(r => r.returnStatus === 'Returned to Vendor')
      break
    case 'scrapped':
      filtered = filtered.filter(r => r.returnStatus === 'Scrapped')
      break
    default:
      break
  }

  const summary: VendorLedgerSummary = {
    unitsReceived: filtered.reduce((s, r) => s + r.quantityPurchased, 0),
    unitsSold: filtered.filter(r => r.salesStatus === 'Sold').reduce((s, r) => s + r.quantityPurchased, 0),
    unitsInStock: filtered.reduce((s, r) => s + r.quantityRemaining, 0),
    unitsReturned: filtered.filter(r => r.returnStatus !== 'Not Returned').reduce((s, r) => s + Math.max(1, r.quantityPurchased), 0),
    serialisedUnits: filtered.filter(r => r.kind === 'serial').length,
    quantityTrackedUnits: filtered.filter(r => r.kind === 'quantity').reduce((s, r) => s + r.quantityPurchased, 0),
  }

  return { rows: filtered, summary }
}

export function vendorLedgerExportMatrix(rows: VendorLedgerRow[]) {
  const headers = [
    'Product', 'SKU', 'Serial / Lot', 'Kind', 'PO', 'Receipt', 'Received date',
    'Warehouse', 'Qty purchased', 'Qty remaining', 'Inventory status',
    'Sales status', 'Sold date', 'Return status', 'Return date', 'Return ref', 'Return reason', 'Days in stock',
  ]
  const data = rows.map(row => [
    row.productName,
    row.sku,
    row.serial || row.lotOrLayer || '',
    row.kind,
    row.purchaseOrderRef || '',
    row.receiptRef || '',
    row.receivedDate || '',
    row.warehouse,
    row.quantityPurchased,
    row.quantityRemaining,
    row.inventoryStatus,
    row.salesStatus,
    row.soldDate || '',
    row.returnStatus,
    row.returnDate || '',
    row.returnRef || '',
    row.returnReason || '',
    row.daysInStock ?? '',
  ])
  return { headers, data }
}

export function downloadVendorLedgerCsv(
  rows: VendorLedgerRow[],
  filename: string,
) {
  const { headers, data } = vendorLedgerExportMatrix(rows)
  const escape = (value: string | number) => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
    return text
  }
  const body = [headers, ...data].map(line => line.map(escape).join(',')).join('\n')
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
