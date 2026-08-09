/**
 * How a catalog product (usually Parts & Components) changes a device config
 * when it appears on a sale order next to a serialized host device.
 *
 * Preferred (explicit) product.specs.reconfiguration:
 * {
 *   "reconfiguration": {
 *     "slot": "ram" | "storage" | "both",
 *     "targetRamGb": 16,          // absolute target after install (preferred)
 *     "addRamGb": 8,              // OR additive delta onto current
 *     "targetStorageGb": 512,
 *     "addStorageGb": 256,
 *     "storageType": "SSD",
 *     "additiveRam": true
 *   }
 * }
 *
 * Fallback: capacityGb + componentSlot on specs, or name patterns
 * ("16GB RAM", "512GB SSD").
 */

export type ReconfigSlot = 'ram' | 'storage' | 'both'

export type ProductReconfigEffect = {
  slot: ReconfigSlot
  /** Absolute RAM target (GB) after work — preferred when set */
  targetRamGb?: number
  /** Additive RAM GB (kept when additiveRam or when only delta is known) */
  addRamGb?: number
  targetStorageGb?: number
  addStorageGb?: number
  storageType?: string | null
  additiveRam?: boolean
  /** Component product id used for install line preference */
  productId: string
  productName: string
  source: 'explicit' | 'capacity' | 'name'
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

function asRecord(specs: unknown): Record<string, unknown> {
  if (!specs) return {}
  if (typeof specs === 'string') {
    try {
      const parsed = JSON.parse(specs)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  if (typeof specs === 'object' && !Array.isArray(specs)) return specs as Record<string, unknown>
  return {}
}

function inferFromName(name: string): Partial<ProductReconfigEffect> | null {
  const ram = name.match(/(\d+)\s*GB\s*(DDR\d?\s*)?RAM\b/i) || name.match(/\bRAM\b.*?(\d+)\s*GB/i)
  const ssd = name.match(/(\d+)\s*GB\s*(SSD|NVMe|M\.?2)/i) || name.match(/(\d+)\s*TB\s*(SSD|NVMe)/i)
  const hdd = name.match(/(\d+)\s*GB\s*HDD/i) || name.match(/(\d+)\s*TB\s*HDD/i)

  if (ram && (ssd || hdd)) {
    const storageMatch = ssd || hdd!
    const storageGb = /TB/i.test(storageMatch[0])
      ? Number(storageMatch[1]) * 1024
      : Number(storageMatch[1])
    return {
      slot: 'both',
      targetRamGb: Number(ram[1]),
      targetStorageGb: storageGb,
      storageType: hdd && !ssd ? 'HDD' : 'SSD',
    }
  }
  if (ram) {
    return { slot: 'ram', targetRamGb: Number(ram[1]), additiveRam: /upgrade|add(itional)?/i.test(name) }
  }
  if (ssd || hdd) {
    const m = ssd || hdd!
    const storageGb = /TB/i.test(m[0]) ? Number(m[1]) * 1024 : Number(m[1])
    return {
      slot: 'storage',
      targetStorageGb: storageGb,
      storageType: hdd && !ssd ? 'HDD' : 'SSD',
    }
  }
  return null
}

/**
 * Parse one product into a reconfiguration effect, or null if it is not a
 * config-changing component line (normal sellable goods return null).
 */
export function parseProductReconfigEffect(product: {
  id: string
  name?: string | null
  specs?: unknown
}): ProductReconfigEffect | null {
  const specs = asRecord(product.specs)
  const explicit = asRecord(specs.reconfiguration)
  const name = String(product.name || '')

  if (Object.keys(explicit).length > 0) {
    const slotRaw = String(explicit.slot || explicit.changeScope || '').toLowerCase()
    const slot: ReconfigSlot =
      slotRaw === 'ram' || slotRaw === 'storage' || slotRaw === 'both'
        ? slotRaw
        : (num(explicit.targetRamGb) || num(explicit.addRamGb)) && (num(explicit.targetStorageGb) || num(explicit.addStorageGb))
          ? 'both'
          : (num(explicit.targetStorageGb) || num(explicit.addStorageGb))
            ? 'storage'
            : 'ram'
    return {
      slot,
      targetRamGb: num(explicit.targetRamGb),
      addRamGb: num(explicit.addRamGb),
      targetStorageGb: num(explicit.targetStorageGb),
      addStorageGb: num(explicit.addStorageGb),
      storageType: explicit.storageType != null ? String(explicit.storageType) : null,
      additiveRam: Boolean(explicit.additiveRam),
      productId: product.id,
      productName: name,
      source: 'explicit',
    }
  }

  const capacityGb = num(specs.capacityGb ?? specs.capacity_gb ?? specs.sizeGb)
  const slotHint = String(specs.componentSlot || specs.slotType || specs.slot || '').toLowerCase()
  if (capacityGb && (slotHint === 'ram' || slotHint === 'storage' || slotHint.includes('ssd') || slotHint.includes('hdd'))) {
    const isRam = slotHint === 'ram'
    return {
      slot: isRam ? 'ram' : 'storage',
      targetRamGb: isRam ? capacityGb : undefined,
      targetStorageGb: isRam ? undefined : capacityGb,
      storageType: isRam ? null : (slotHint.includes('hdd') ? 'HDD' : 'SSD'),
      additiveRam: isRam ? Boolean(specs.additiveRam) : undefined,
      productId: product.id,
      productName: name,
      source: 'capacity',
    }
  }

  const fromName = inferFromName(name)
  if (!fromName) return null
  return {
    slot: fromName.slot || 'ram',
    targetRamGb: fromName.targetRamGb,
    addRamGb: fromName.addRamGb,
    targetStorageGb: fromName.targetStorageGb,
    addStorageGb: fromName.addStorageGb,
    storageType: fromName.storageType ?? null,
    additiveRam: fromName.additiveRam,
    productId: product.id,
    productName: name,
    source: 'name',
  }
}

export function mergeEffectsIntoTarget(params: {
  current: { totalRamGb: number; primaryStorageGb?: number | null; storageType?: string | null; processor?: string | null; processorGeneration?: string | null }
  effects: ProductReconfigEffect[]
}): import('./types').TargetConfigInput | null {
  if (!params.effects.length) return null

  let totalRamGb = Math.max(0, Number(params.current.totalRamGb) || 0)
  let primaryStorageGb = Math.max(0, Number(params.current.primaryStorageGb) || 0)
  let storageType = params.current.storageType || 'SSD'
  let changeScope: 'ram' | 'storage' | 'both' = 'ram'
  let touchedRam = false
  let touchedStorage = false
  let additiveRam = false
  let ramProductId: string | undefined
  let storageProductId: string | undefined

  const baseRam = Math.max(0, Number(params.current.totalRamGb) || 0)
  const baseStorage = Math.max(0, Number(params.current.primaryStorageGb) || 0)
  totalRamGb = baseRam
  primaryStorageGb = baseStorage

  for (const effect of params.effects) {
    if (effect.slot === 'ram' || effect.slot === 'both') {
      touchedRam = true
      if (effect.addRamGb != null || effect.additiveRam) {
        // Additive: grow from original base (or from absolute target if only target given)
        totalRamGb = effect.addRamGb != null
          ? baseRam + effect.addRamGb
          : (effect.targetRamGb != null ? Math.max(baseRam, effect.targetRamGb) : totalRamGb)
        additiveRam = true
      } else if (effect.targetRamGb != null) {
        totalRamGb = effect.targetRamGb
      }
      ramProductId = effect.productId
    }
    if (effect.slot === 'storage' || effect.slot === 'both') {
      touchedStorage = true
      if (effect.addStorageGb != null) {
        primaryStorageGb = baseStorage + effect.addStorageGb
      } else if (effect.targetStorageGb != null) {
        primaryStorageGb = effect.targetStorageGb
      }
      if (effect.storageType) storageType = effect.storageType
      storageProductId = effect.productId
    }
  }

  if (touchedRam && touchedStorage) changeScope = 'both'
  else if (touchedStorage) changeScope = 'storage'
  else changeScope = 'ram'

  // No-op if nothing actually changes
  const sameRam = totalRamGb === (Number(params.current.totalRamGb) || 0)
  const sameStorage = primaryStorageGb === (Number(params.current.primaryStorageGb) || 0)
  if (sameRam && sameStorage) return null

  return {
    changeScope,
    totalRamGb,
    primaryStorageGb,
    storageType,
    processor: params.current.processor ?? null,
    processorGeneration: params.current.processorGeneration ?? null,
    ramProductId,
    storageProductId,
    additiveRam: additiveRam || undefined,
  }
}
