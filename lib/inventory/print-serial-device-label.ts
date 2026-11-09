/**
 * Client helper: print machine stickers for SerialNumber rows, with RAM/SSD
 * from the current reconfiguration snapshot when available.
 */

import type { Product, SerialNumber } from '@/lib/store'
import { fetchSerialCurrentConfig } from '@/lib/inventory/serial-device-label'
import { buildMachineLabelView } from '@/lib/inventory/machine-label'
import { printMachineLabels } from '@/lib/inventory/machine-label-template'

/**
 * Asset IDs for machines about to be labelled: those without one get it now
 * (server counter, per category) — existing machines are numbered the first
 * time their label is printed. Returns id → asset ID; {} when offline.
 */
async function ensureAssetIds(serials: SerialNumber[]): Promise<Record<string, string>> {
  const missing = serials.filter(s => !(s as SerialNumber & { assetId?: string }).assetId).map(s => s.id)
  if (!missing.length) return {}
  try {
    const res = await fetch('/api/inventory/asset-ids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serialIds: missing }) })
    const data = await res.json().catch(() => ({}))
    return res.ok && data?.assetIds ? data.assetIds as Record<string, string> : {}
  } catch {
    return {}
  }
}

/** Print the 58 × 38 mm machine stickers (lib/inventory/machine-label-template.ts). */
export async function printLabelsForSerialUnits(opts: {
  serials: SerialNumber[]
  products: Product[]
  /** Customer sticker even though the unit is still with the repair unit (job ready). */
  forSale?: boolean
}): Promise<void> {
  const { serials, products, forSale } = opts
  if (!serials.length) return

  const productById = new Map(products.map(p => [p.id, p]))
  const assigned = await ensureAssetIds(serials)

  const views = await Promise.all(
    serials.map(async s => {
      const product = productById.get(s.productId)
      const x = s as SerialNumber & { assetId?: string; identityPending?: boolean }
      const currentConfig = await fetchSerialCurrentConfig(s.id)
      return buildMachineLabelView({
        productName: s.productName || product?.name || 'Device',
        category: product?.category,
        productType: (product as { productType?: string } | undefined)?.productType,
        specsText: s.specs || currentConfig?.displayName || null,
        currentConfig: currentConfig as never,
        serial: s.serial,
        identityPending: x.identityPending,
        assetId: x.assetId || assigned[s.id] || null,
        barcode: s.barcode,
        location: s.location,
        status: s.status,
        receivedDate: s.receivedDate,
        forSale,
      })
    }),
  )

  printMachineLabels(views)
}
