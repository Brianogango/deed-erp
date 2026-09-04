/**
 * Deed ERP serialized-device inventory label — 80mm × 40mm landscape thermal sticker.
 * Uses the shared thermal label renderer so Warehouse, GRN and Product Master
 * all print the same visual system.
 */

import {
  buildSerialDeviceLabelView,
  type SerialDeviceLabelInput,
  type SerialDeviceLabelView,
} from '@/lib/inventory/serial-device-label-data'
import { printThermalLabelBatch } from '@/lib/inventory/thermal-label-template'

export type { SerialDeviceLabelInput, SerialDeviceLabelView } from '@/lib/inventory/serial-device-label-data'
export { buildSerialDeviceLabelView, buildSerialDeviceQrUrl } from '@/lib/inventory/serial-device-label-data'

export type PrintSerialDeviceLabelSource = Omit<SerialDeviceLabelInput, 'qrUrl' | 'website' | 'phone'> & {
  /** Retained for API compatibility; QR is intentionally not printed on the 80×40 label. */
  qrUrl?: string
  website?: string | null
  phone?: string | null
}

/**
 * Print one or more 80×40mm serialized-device labels.
 * Pass currentConfig so processor/RAM/storage reflect the actual unit after reconfiguration.
 */
export async function printSerialDeviceLabels(items: PrintSerialDeviceLabelSource[]): Promise<void> {
  if (!items.length || typeof window === 'undefined') return

  const labels = items.map(item => {
    const view = buildSerialDeviceLabelView({
      ...item,
      qrUrl: item.qrUrl || '',
      website: item.website || '',
      phone: item.phone || '',
    })

    return {
      title: view.productName,
      barcodeValue: view.barcodeValue,
      caption: view.serial || view.barcodeValue,
      specs: [
        { label: 'Processor', value: view.cpu },
        { label: 'RAM', value: view.ram },
        { label: 'Storage', value: view.storage },
      ],
    }
  })

  printThermalLabelBatch(labels, 'Serial Device Labels')
}

type DeviceConfigFieldsLite = {
  processor?: string | null
  processorGeneration?: string | null
  totalRamGb?: number
  primaryStorageGb?: number | null
  storageType?: string | null
  screenSize?: string | null
  screenResolution?: string | null
  displayName?: string
  grade?: string | null
  ramComposition?: Array<{ technology?: string }>
}

/**
 * Fetch current device configuration for a serial (snapshot wins over blob specs).
 * Returns null when the API is unavailable — caller should still print with specsText.
 */
export async function fetchSerialCurrentConfig(serialId: string): Promise<Partial<DeviceConfigFieldsLite> | null> {
  try {
    const res = await fetch(`/api/reconfiguration/device/${encodeURIComponent(serialId)}/configuration`, {
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data?.current || data?.device?.current || null) as Partial<DeviceConfigFieldsLite> | null
  } catch {
    return null
  }
}
