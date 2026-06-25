import { makeCollectionHandlers } from '@/lib/server-store-crud'
import type { SerialNumber } from '@/lib/store'
import { buildInventoryBarcode } from '@/lib/inventory-identifiers'

const config = {
  storeKey: 'deed_serials',
  allowedWriteRoles: ['director', 'admin_officer', 'finance_officer', 'inventory_officer', 'technical_lead'],
  build: (body: Record<string, unknown>, existing: SerialNumber[]): SerialNumber | string => {
    if (!body.productId) return 'productId is required'
    const serial = String(body.serial ?? '').trim()
    if (!serial) return 'serial is required'

    const serialConflict = existing.find(item => String(item.serial ?? '').toLowerCase() === serial.toLowerCase())
    if (serialConflict) return `Serial "${serial}" already exists`

    const requestedBarcode = String(body.barcode ?? '').trim()
    const barcode = requestedBarcode || buildInventoryBarcode({
      existingBarcodes: existing.map(item => item.barcode),
      manufacturerSerial: serial,
      productSku: String(body.productId ?? ''),
    })
    const barcodeConflict = existing.find(item => String(item.barcode ?? '').toLowerCase() === barcode.toLowerCase())
    if (barcodeConflict) return `Inventory barcode "${barcode}" already exists`

    return {
      ...(body as unknown as SerialNumber),
      id: String(body.id ?? crypto.randomUUID()),
      serial,
      barcode,
      status: String(body.status ?? 'available') as SerialNumber['status'],
      receivedDate: String(body.receivedDate ?? new Date().toISOString().slice(0, 10)),
    } as SerialNumber
  },
}

export const { GET, POST } = makeCollectionHandlers(config)
