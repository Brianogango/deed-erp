/**
 * Resolve this physical unit's RAM/SSD for reconfiguration.
 *
 * Catalog Product.name stays the shelf SKU. serial.specs / snapshot are the
 * live unit. When those are empty (normal for GRN/opening stock), fall back
 * to structured product.specs.deviceConfig, then parse the product title.
 */

import { buildDisplayName, buildSpecsString, parseSpecsString } from './display-name'
import type { DeviceConfigFields, InstalledComponentView } from './types'

export type UnitConfigSource =
  | 'installed'
  | 'snapshot'
  | 'serial_specs'
  | 'product_specs'
  | 'product_name'
  | 'unresolved'

export type DeviceConfigDefault = {
  totalRamGb: number
  primaryStorageGb?: number | null
  storageType?: string | null
  processor?: string | null
  processorGeneration?: string | null
}

export const UNIT_CONFIG_SOURCE_LABEL: Record<UnitConfigSource, string> = {
  installed: 'from installed parts',
  snapshot: 'from this unit',
  serial_specs: 'from this unit',
  product_specs: 'from product',
  product_name: 'from product name',
  unresolved: 'could not read RAM/SSD',
}

export function isReconfigurableCatalogCategory(category?: string | null): boolean {
  const c = String(category || '').trim().toLowerCase()
  return c === 'laptops' || c === 'desktops'
}

export function hasCapacity(
  config?: { totalRamGb?: number | null; primaryStorageGb?: number | null } | null,
): boolean {
  if (!config) return false
  return (Number(config.totalRamGb) || 0) > 0 || (Number(config.primaryStorageGb) || 0) > 0
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      return {}
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export function deviceConfigFromProductSpecs(specs: unknown): DeviceConfigDefault | null {
  const rec = asRecord(specs)
  const nested = rec.deviceConfig && typeof rec.deviceConfig === 'object' && !Array.isArray(rec.deviceConfig)
    ? rec.deviceConfig as Record<string, unknown>
    : rec
  const totalRamGb = num(nested.totalRamGb ?? nested.ramGb)
  const primaryStorageGb = num(nested.primaryStorageGb ?? nested.storageGb) || null
  const storageType = nested.storageType != null && String(nested.storageType).trim()
    ? String(nested.storageType).trim()
    : null
  const processor = nested.processor != null && String(nested.processor).trim()
    ? String(nested.processor).trim()
    : null
  const processorGeneration = nested.processorGeneration != null && String(nested.processorGeneration).trim()
    ? String(nested.processorGeneration).trim()
    : null
  const config: DeviceConfigDefault = {
    totalRamGb,
    primaryStorageGb,
    storageType,
    processor,
    processorGeneration,
  }
  return hasCapacity(config) ? config : null
}

export function catalogDeviceConfig(
  name: string,
  category?: string | null,
  overrides?: {
    totalRamGb?: number | null
    primaryStorageGb?: number | null
    storageType?: string | null
  },
): DeviceConfigDefault | null {
  if (!isReconfigurableCatalogCategory(category)) return null
  const parsed = parseSpecsString(name)
  const totalRamGb = (parsed.totalRamGb || 0) > 0
    ? Number(parsed.totalRamGb)
    : num(overrides?.totalRamGb)
  const primaryStorageGb = (parsed.primaryStorageGb || 0) > 0
    ? Number(parsed.primaryStorageGb)
    : (num(overrides?.primaryStorageGb) || null)
  const storageType = parsed.storageType
    || (overrides?.storageType ? String(overrides.storageType).trim() : null)
    || (primaryStorageGb ? 'SSD' : null)
  const config: DeviceConfigDefault = {
    totalRamGb,
    primaryStorageGb,
    storageType,
    processor: parsed.processor ?? null,
    processorGeneration: parsed.processorGeneration ?? null,
  }
  return hasCapacity(config) ? config : null
}

/** Merge detected device config into Prisma products.specs without dropping kind/unit/tax. */
export function withCatalogDeviceConfig(
  specs: Record<string, unknown>,
  name: string,
  category?: string | null,
  overrides?: {
    totalRamGb?: number | null
    primaryStorageGb?: number | null
    storageType?: string | null
  },
): Record<string, unknown> {
  const next = { ...specs }
  const deviceConfig = catalogDeviceConfig(name, category, overrides)
  if (deviceConfig) next.deviceConfig = deviceConfig
  else delete next.deviceConfig
  return next
}

export function compactSpecsString(config: Partial<DeviceConfigFields> | DeviceConfigDefault | null | undefined): string {
  if (!config || !hasCapacity(config)) return ''
  return buildSpecsString({
    processor: config.processor,
    processorGeneration: config.processorGeneration,
    totalRamGb: Number(config.totalRamGb) || 0,
    ramComposition: [],
    primaryStorageGb: config.primaryStorageGb,
    storageType: config.storageType,
  })
}

/**
 * Specs to stamp on a new serial. Typed GRN text wins; otherwise copy the
 * catalog default (structured specs, then the product title).
 */
export function seedSerialSpecs(opts: {
  typedSpecs?: string | null
  productName?: string | null
  productSpecs?: unknown
  deviceConfig?: DeviceConfigDefault | null
}): string | undefined {
  const typed = String(opts.typedSpecs || '').trim()
  if (typed) return typed
  const fromProduct = opts.deviceConfig && hasCapacity(opts.deviceConfig)
    ? opts.deviceConfig
    : deviceConfigFromProductSpecs(opts.productSpecs)
  if (fromProduct && hasCapacity(fromProduct)) return compactSpecsString(fromProduct) || undefined
  const parsed = parseSpecsString(opts.productName)
  if (hasCapacity(parsed)) return compactSpecsString(parsed) || undefined
  return undefined
}

function isRamInstall(row: InstalledComponentView): boolean {
  return row.category === 'ram' || row.slotType === 'ram_slot'
}

function isStorageInstall(row: InstalledComponentView): boolean {
  return row.category === 'storage' || row.slotType === 'm2_slot' || row.slotType === 'sata_bay'
}

function configFromInstalled(installed?: InstalledComponentView[] | null): Partial<DeviceConfigFields> | null {
  const rows = installed || []
  const ram = rows.filter(isRamInstall)
  const storage = rows.filter(isStorageInstall)
  const totalRamGb = ram.reduce((sum, row) => sum + (Number(row.capacityGb) || 0) * (Number(row.quantity) || 1), 0)
  const primaryStorageGb = storage.reduce((sum, row) => sum + (Number(row.capacityGb) || 0) * (Number(row.quantity) || 1), 0)
  if (totalRamGb <= 0 && primaryStorageGb <= 0) return null
  const storageType = storage.find(row => row.technology)?.technology || (primaryStorageGb > 0 ? 'SSD' : null)
  return {
    totalRamGb,
    ramComposition: ram.map(row => ({
      slotType: row.slotType,
      slotNumber: row.slotNumber,
      capacityGb: Number(row.capacityGb) || 0,
      removable: row.removable !== false,
    })),
    primaryStorageGb: primaryStorageGb > 0 ? primaryStorageGb : null,
    storageType,
    displayName: '',
  }
}

function emptyConfig(displayName = ''): DeviceConfigFields {
  return {
    totalRamGb: 0,
    ramComposition: [],
    primaryStorageGb: null,
    storageType: null,
    processor: null,
    processorGeneration: null,
    displayName,
  }
}

function overlayCpu(
  base: Partial<DeviceConfigFields>,
  extras: Array<Partial<DeviceConfigFields> | null | undefined>,
): Partial<DeviceConfigFields> {
  let processor = base.processor || null
  let processorGeneration = base.processorGeneration || null
  for (const extra of extras) {
    if (!processor && extra?.processor) processor = extra.processor
    if (!processorGeneration && extra?.processorGeneration) processorGeneration = extra.processorGeneration
  }
  return { ...base, processor, processorGeneration }
}

export function resolveUnitConfig(input: {
  installed?: InstalledComponentView[] | null
  snapshot?: Partial<DeviceConfigFields> | null
  serialSpecs?: string | null
  productSpecs?: unknown
  productName?: string | null
}): { current: DeviceConfigFields; source: UnitConfigSource } {
  const productName = String(input.productName || '').trim()
  const fromInstalled = configFromInstalled(input.installed)
  const fromSnapshot = hasCapacity(input.snapshot) ? input.snapshot : null
  const fromSerial = (() => {
    const parsed = parseSpecsString(input.serialSpecs)
    return hasCapacity(parsed) ? parsed : null
  })()
  const fromProductSpecs = deviceConfigFromProductSpecs(input.productSpecs)
  const fromName = (() => {
    const parsed = parseSpecsString(productName)
    return hasCapacity(parsed) ? parsed : null
  })()

  let source: UnitConfigSource = 'unresolved'
  let picked: Partial<DeviceConfigFields> | null = null
  if (fromInstalled) {
    source = 'installed'
    picked = fromInstalled
  } else if (fromSnapshot) {
    source = 'snapshot'
    picked = fromSnapshot
  } else if (fromSerial) {
    source = 'serial_specs'
    picked = fromSerial
  } else if (fromProductSpecs) {
    source = 'product_specs'
    picked = fromProductSpecs
  } else if (fromName) {
    source = 'product_name'
    picked = fromName
  }

  const withCpu = overlayCpu(picked || {}, [input.snapshot, fromSerial, fromName, fromProductSpecs])
  const totalRamGb = Number(withCpu.totalRamGb) || 0
  const primaryStorageGb = withCpu.primaryStorageGb ?? null
  const storageType = withCpu.storageType ?? (primaryStorageGb ? 'SSD' : null)

  let displayName = String(withCpu.displayName || '').trim()
  if (!displayName) {
    if (source === 'serial_specs') displayName = String(input.serialSpecs || '').trim()
    else if (source === 'product_name' || source === 'product_specs') displayName = productName
    else if (source === 'snapshot') displayName = String(input.snapshot?.displayName || '').trim()
  }
  if (!displayName) {
    displayName = buildDisplayName({
      productName: productName || 'Device',
      config: {
        processor: withCpu.processor,
        processorGeneration: withCpu.processorGeneration,
        totalRamGb,
        ramComposition: withCpu.ramComposition || [],
        primaryStorageGb,
        storageType,
      },
    })
  }

  if (source === 'unresolved') {
    return { current: emptyConfig(productName), source }
  }

  return {
    source,
    current: {
      processor: withCpu.processor ?? null,
      processorGeneration: withCpu.processorGeneration ?? null,
      totalRamGb,
      ramComposition: withCpu.ramComposition || [],
      primaryStorageGb,
      secondaryStorageGb: withCpu.secondaryStorageGb ?? null,
      storageType,
      screenSize: withCpu.screenSize ?? null,
      screenResolution: withCpu.screenResolution ?? null,
      touchscreen: withCpu.touchscreen ?? null,
      graphics: withCpu.graphics ?? null,
      operatingSystem: withCpu.operatingSystem ?? null,
      keyboardLayout: withCpu.keyboardLayout ?? null,
      colour: withCpu.colour ?? null,
      includedAccessories: withCpu.includedAccessories || [],
      batteryCondition: withCpu.batteryCondition ?? null,
      grade: withCpu.grade ?? null,
      displayName,
    },
  }
}
