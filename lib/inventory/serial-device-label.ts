/**
 * A serial unit's current configuration (RAM/SSD after upgrades), for its
 * machine sticker — lib/inventory/print-serial-device-label.ts.
 */

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
