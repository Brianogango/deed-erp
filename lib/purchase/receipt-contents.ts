import type { LocationId, Receipt, SerialNumber } from '@/lib/store'

export const SERIAL_STATUS_LABEL: Record<SerialNumber['status'], string> = {
  available: 'Available',
  assigned: 'Assigned',
  sold: 'Sold',
  under_repair: 'Under repair',
  returned: 'Returned',
  written_off: 'Written off',
  refurbishment: 'Refurbishment',
  reconfiguration: 'Reconfiguration',
  capitalised: 'Capitalised',
}

export type ReceiptSerialView = {
  serial: string
  serialId?: string
  status?: SerialNumber['status']
  specs?: string
  accessories: string[]
  accessoryNotes?: string
  location?: LocationId
}

export type ReceiptLineView = {
  productId: string
  productName: string
  qtyExpected: number
  qtyReceived: number
  requiresSerial: boolean
  specs?: string
  serials: ReceiptSerialView[]
}

function matchSerial(
  serials: SerialNumber[],
  value: string,
  productId: string,
  receiptId: string,
): SerialNumber | undefined {
  const needle = value.trim().toUpperCase()
  return serials.find(s =>
    s.serial.toUpperCase() === needle
    && (s.receiptId === receiptId || s.productId === productId),
  ) ?? serials.find(s => s.serial.toUpperCase() === needle)
}

function toView(serial: string, rec?: SerialNumber, lineSpecs?: string): ReceiptSerialView {
  return {
    serial,
    serialId: rec?.id,
    status: rec?.status,
    specs: rec?.specs || lineSpecs,
    accessories: rec?.accessories ?? [],
    accessoryNotes: rec?.accessoryNotes,
    location: rec?.location,
  }
}

/** Join GRN lines with live serial records (specs, accessories, status). */
export function receiptLineViews(receipt: Receipt, serials: SerialNumber[]): ReceiptLineView[] {
  const listed = new Set<string>()
  const lines = receipt.lines.map(line => {
    const units = line.serials.map(sn => {
      listed.add(sn.trim().toUpperCase())
      return toView(sn, matchSerial(serials, sn, line.productId, receipt.id), line.specs)
    })
    return {
      productId: line.productId,
      productName: line.productName,
      qtyExpected: line.qtyExpected,
      qtyReceived: line.qtyReceived,
      requiresSerial: line.requiresSerial,
      specs: line.specs,
      serials: units,
    }
  })

  const extras = serials.filter(s =>
    s.receiptId === receipt.id && !listed.has(s.serial.trim().toUpperCase()),
  )
  for (const extra of extras) {
    const line = lines.find(l => l.productId === extra.productId)
    if (line) {
      line.serials.push(toView(extra.serial, extra, line.specs))
    } else {
      lines.push({
        productId: extra.productId,
        productName: extra.productName,
        qtyExpected: 0,
        qtyReceived: 1,
        requiresSerial: true,
        specs: undefined,
        serials: [toView(extra.serial, extra)],
      })
    }
  }

  return lines
}

export function receiptSerialCount(receipt: Pick<Receipt, 'lines'>): number {
  return receipt.lines.reduce((n, line) => n + line.serials.length, 0)
}

export function receiptQtyReceived(receipt: Pick<Receipt, 'lines'>): number {
  return receipt.lines.reduce((n, line) => n + (Number(line.qtyReceived) || 0), 0)
}

export function receiptSearchBlob(receipt: Receipt): string {
  const serials = receipt.lines.flatMap(l => l.serials).join(' ')
  const products = receipt.lines.map(l => l.productName).join(' ')
  return `${receipt.ref} ${receipt.vendorName} ${receipt.poRef} ${products} ${serials}`
}
