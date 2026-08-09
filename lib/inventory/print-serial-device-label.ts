/**
 * Client helper: build + print 100×60mm labels for blob SerialNumber rows,
 * enriching RAM/SSD from the current reconfiguration snapshot when available.
 */

import { LOCATIONS, type LocationId, type Product, type SerialNumber } from '@/lib/store'
import {
  fetchSerialCurrentConfig,
  printSerialDeviceLabels,
  type PrintSerialDeviceLabelSource,
} from '@/lib/inventory/serial-device-label'
import type { DeviceConfigFields } from '@/lib/reconfiguration/types'

function locationLabel(location: LocationId | string | undefined): string {
  if (!location) return '—'
  const known = LOCATIONS[location as LocationId]
  return known?.name || String(location)
}

export async function printLabelsForSerialUnits(opts: {
  serials: SerialNumber[]
  products: Product[]
}): Promise<void> {
  const { serials, products } = opts
  if (!serials.length) return

  const productById = new Map(products.map(p => [p.id, p]))

  const items: PrintSerialDeviceLabelSource[] = await Promise.all(
    serials.map(async s => {
      const product = productById.get(s.productId)
      const currentConfig = await fetchSerialCurrentConfig(s.id)
      return {
        serialId: s.id,
        serial: s.serial,
        barcode: s.barcode,
        productName: s.productName || product?.name || 'DEVICE',
        productCategory: product?.category,
        productDescription: product?.description,
        productType: (product as { productType?: string } | undefined)?.productType,
        warrantyMonths: product?.warrantyMonths,
        receivedDate: s.receivedDate,
        locationLabel: locationLabel(s.location),
        status: s.status,
        specsText: s.specs || currentConfig?.displayName || null,
        currentConfig: (currentConfig as Partial<DeviceConfigFields> | null) || undefined,
      }
    }),
  )

  await printSerialDeviceLabels(items)
}
