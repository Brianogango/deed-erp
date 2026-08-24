/**
 * Bench reconfiguration — the physical job, not a target-GB wizard.
 *
 * RAM and SSD/storage use the SAME four moves. The technician picks the
 * action; the new total is calculated from that action. We never invent a
 * capacity that does not match a real stick or drive.
 *
 *   pull_one  — dual module: take one out, leave the other
 *               (RAM 8+8 → 8; SSD+HDD → the drive that stays)
 *   swap      — take the fitted module out, put a different one in
 *               (16GB → 8GB, 512GB → 256GB, and the upgrade inverse)
 *   add_one   — fit a second module next to the one already in
 *   none      — leave this slot alone (the other slot may still change)
 *
 * After the job the UNIT selling name (serial.specs / displayName) shows the
 * new RAM and/or SSD. The catalog Product.name / SKU is not rewritten.
 */

import { buildDisplayName } from './display-name'
import { catalogBaseName, rewriteUnitCapacitiesInText } from './unit-selling-name'
import type {
  DeviceConfigFields,
  InstalledComponentView,
  ReconfigTransactionType,
} from './types'

export type BenchSlot = 'ram' | 'storage'
export type BenchActionKind = 'none' | 'pull_one' | 'swap' | 'add_one'

export interface BenchModule {
  capacityGb: number
  removable: boolean
  productId?: string
  installationId?: string
  slotNumber?: number
}

export interface BenchSlotRequest {
  slot: BenchSlot
  action: BenchActionKind
  /** Total currently in the machine (from specs when composition is unknown). */
  currentTotalGb: number
  /**
   * How many removable modules are fitted. Required when composition is
   * unknown. 2 → pull_one is valid; 1 → use swap or add_one.
   */
  moduleCount?: number
  currentModules?: BenchModule[]
  /** Which module to pull when they are unequal. Defaults to the largest removable. */
  pullCapacityGb?: number
  /** Incoming part — required for swap and add_one. */
  incoming?: { productId: string; capacityGb: number; productName?: string }
  /**
   * Catalog product the removed module becomes in parts stock.
   * Required for pull_one and swap when the module has no productId.
   */
  outgoingProductId?: string
  outgoingProductName?: string
  storageType?: string | null
}

export interface BenchStockMove {
  kind: 'remove' | 'install'
  slot: BenchSlot
  productId: string
  productName?: string
  capacityGb: number
  installationId?: string
  slotNumber: number
}

export interface BenchSlotResult {
  slot: BenchSlot
  action: BenchActionKind
  beforeGb: number
  afterGb: number
  remainingModules: BenchModule[]
  removals: BenchStockMove[]
  installations: BenchStockMove[]
  storageType?: string | null
  error?: string
}

export interface BenchJobResult {
  ram: BenchSlotResult
  storage: BenchSlotResult
  before: { ramGb: number; storageGb: number; displayName: string }
  after: { ramGb: number; storageGb: number; displayName: string; storageType: string | null }
  transactionType: ReconfigTransactionType
  reason: string
  error?: string
}

const SLOT_LABEL: Record<BenchSlot, string> = {
  ram: 'RAM',
  storage: 'SSD / storage',
}

function isRamLike(row: InstalledComponentView): boolean {
  return row.category === 'ram' || row.slotType === 'ram_slot'
}

function isStorageLike(row: InstalledComponentView): boolean {
  return row.category === 'storage' || row.slotType === 'm2_slot' || row.slotType === 'sata_bay'
}

/** Map recorded installations onto the shared module shape. */
export function modulesFromInstalled(
  installed: InstalledComponentView[] | null | undefined,
  slot: BenchSlot,
): BenchModule[] {
  const rows = (installed || []).filter(i => (slot === 'ram' ? isRamLike(i) : isStorageLike(i)))
  return rows.map(i => ({
    capacityGb: Number(i.capacityGb) || 0,
    removable: i.removable !== false,
    productId: i.componentProductId,
    installationId: i.id,
    slotNumber: i.slotNumber,
  }))
}

function equalSplit(totalGb: number, count: number): number[] {
  const each = Math.floor(totalGb / count)
  const sizes = Array.from({ length: count }, () => each)
  const remainder = totalGb - each * count
  if (remainder > 0) sizes[0] += remainder
  return sizes
}

/**
 * When the technician has not recorded a component graph, build modules from
 * the declared stick/drive count and the current total GB.
 */
export function inferModules(req: BenchSlotRequest): BenchModule[] {
  if (req.currentModules && req.currentModules.length > 0) {
    return req.currentModules.map((m, idx) => ({
      ...m,
      slotNumber: m.slotNumber || idx + 1,
    }))
  }
  const count = Math.max(0, Math.floor(Number(req.moduleCount) || 0))
  const total = Math.max(0, Math.floor(Number(req.currentTotalGb) || 0))
  if (count < 1 || total < 1) return []
  return equalSplit(total, count).map((capacityGb, idx) => ({
    capacityGb,
    removable: true,
    productId: req.outgoingProductId,
    slotNumber: idx + 1,
  }))
}

function pickPullTarget(modules: BenchModule[], pullCapacityGb?: number): BenchModule | undefined {
  const removable = modules.filter(m => m.removable !== false && m.capacityGb > 0)
  if (pullCapacityGb && pullCapacityGb > 0) {
    return removable.find(m => m.capacityGb === pullCapacityGb) || removable[0]
  }
  return [...removable].sort((a, b) => b.capacityGb - a.capacityGb)[0]
}

function nextSlotNumber(modules: BenchModule[]): number {
  const used = new Set(modules.map(m => m.slotNumber || 0))
  let n = 1
  while (used.has(n)) n += 1
  return n
}

/**
 * Remaining modules that still need a device_component_installations row.
 * Skip sticks we just installed in this job — reseeding them hits
 * idx_device_installs_active_slot (serial, slot_type, slot_number).
 */
export function remainingModulesToSeed(
  remaining: BenchModule[],
  justInstalled: BenchStockMove[],
): BenchModule[] {
  const taken = new Set(justInstalled.map(m => m.slotNumber).filter(n => n > 0))
  return remaining.filter(m => {
    if (m.installationId) return false
    if (!m.productId) return false
    const slot = m.slotNumber || 0
    if (slot && taken.has(slot)) return false
    return true
  })
}

function benchUnitName(params: {
  productName?: string | null
  brand?: string | null
  model?: string | null
  current: Pick<
    DeviceConfigFields,
    'processor' | 'processorGeneration' | 'totalRamGb' | 'primaryStorageGb' | 'storageType' | 'ramComposition' | 'displayName'
  >
  ramGb: number
  storageGb: number
  storageType: string | null
}): string {
  const catalog = String(params.productName || '').trim()
  const rewrittenCatalog = catalog
    ? rewriteUnitCapacitiesInText(catalog, params.ramGb || null, params.storageGb || null, params.storageType)
    : ''
  if (params.ramGb > 0 && rewrittenCatalog.includes(`${params.ramGb}GB`)) return rewrittenCatalog
  const rewrittenLive = rewriteUnitCapacitiesInText(
    params.current.displayName || '',
    params.ramGb || null,
    params.storageGb || null,
    params.storageType,
  )
  if (params.ramGb > 0 && rewrittenLive.includes(`${params.ramGb}GB`)) return rewrittenLive
  return buildDisplayName({
    brand: params.brand,
    model: params.model,
    productName: catalogBaseName(catalog) || catalog || 'Device',
    config: {
      processor: params.current.processor,
      processorGeneration: params.current.processorGeneration,
      totalRamGb: params.ramGb,
      ramComposition: params.current.ramComposition || [],
      primaryStorageGb: params.storageGb,
      storageType: params.storageType,
    },
  })
}

function fail(req: BenchSlotRequest, beforeGb: number, message: string): BenchSlotResult {
  return {
    slot: req.slot,
    action: req.action,
    beforeGb,
    afterGb: beforeGb,
    remainingModules: inferModules(req),
    removals: [],
    installations: [],
    storageType: req.storageType,
    error: message,
  }
}

/**
 * Apply one slot's bench action. RAM and storage share this function —
 * only labels and the incoming storageType differ.
 */
export function applyBenchSlot(req: BenchSlotRequest): BenchSlotResult {
  const label = SLOT_LABEL[req.slot]
  const beforeGb = Math.max(0, Math.floor(Number(req.currentTotalGb) || 0))
  const action = req.action || 'none'

  if (action === 'none') {
    return {
      slot: req.slot,
      action: 'none',
      beforeGb,
      afterGb: beforeGb,
      remainingModules: inferModules(req),
      removals: [],
      installations: [],
      storageType: req.storageType,
    }
  }

  const modules = inferModules(req)
  const incomingGb = Math.max(0, Math.floor(Number(req.incoming?.capacityGb) || 0))

  if (action === 'add_one') {
    if (!req.incoming?.productId || incomingGb <= 0) {
      return fail(req, beforeGb, `Select the ${label} part to fit, with its capacity in GB.`)
    }
    const slotNumber = nextSlotNumber(modules)
    const afterGb = beforeGb + incomingGb
    const remaining: BenchModule[] = [
      ...modules,
      {
        capacityGb: incomingGb,
        removable: true,
        productId: req.incoming.productId,
        slotNumber,
      },
    ]
    return {
      slot: req.slot,
      action,
      beforeGb,
      afterGb,
      remainingModules: remaining,
      removals: [],
      installations: [
        {
          kind: 'install',
          slot: req.slot,
          productId: req.incoming.productId,
          productName: req.incoming.productName,
          capacityGb: incomingGb,
          slotNumber,
        },
      ],
      storageType: req.storageType,
    }
  }

  if (modules.length === 0) {
    return fail(
      req,
      beforeGb,
      `Say how ${label} is fitted now (one module or two). Current total is ${beforeGb || 'unknown'}GB.`,
    )
  }

  const removable = modules.filter(m => m.removable !== false)
  if (removable.length === 0) {
    return fail(req, beforeGb, `${label} is soldered/onboard and cannot be pulled or swapped.`)
  }

  if (action === 'pull_one') {
    if (removable.length < 2 && modules.length < 2) {
      return fail(
        req,
        beforeGb,
        `Only one ${label} module is fitted. Pull-one needs two (leave one in). Use swap to replace it.`,
      )
    }
    const target = pickPullTarget(modules, req.pullCapacityGb)
    if (!target) return fail(req, beforeGb, `Nothing removable to pull from ${label}.`)
    const outgoingProductId = target.productId || req.outgoingProductId
    if (!outgoingProductId) {
      return fail(req, beforeGb, `Pick the parts product the pulled ${label} becomes in stock.`)
    }
    const remaining = modules.filter(m => m !== target)
    const afterGb = remaining.reduce((s, m) => s + m.capacityGb, 0)
    return {
      slot: req.slot,
      action,
      beforeGb,
      afterGb,
      remainingModules: remaining,
      removals: [
        {
          kind: 'remove',
          slot: req.slot,
          productId: outgoingProductId,
          productName: req.outgoingProductName,
          capacityGb: target.capacityGb,
          installationId: target.installationId,
          slotNumber: target.slotNumber || 1,
        },
      ],
      installations: [],
      storageType: req.storageType,
    }
  }

  // swap — pull one module, fit a different one in the same slot
  if (!req.incoming?.productId || incomingGb <= 0) {
    return fail(req, beforeGb, `Select the ${label} part to fit, with its capacity in GB.`)
  }
  const target = pickPullTarget(modules, req.pullCapacityGb) || removable[0]
  const outgoingProductId = target.productId || req.outgoingProductId
  if (!outgoingProductId) {
    return fail(req, beforeGb, `Pick the parts product the removed ${label} becomes in stock.`)
  }
  if (outgoingProductId === req.incoming.productId && target.capacityGb === incomingGb) {
    return fail(req, beforeGb, `${label} swap would put the same capacity back — nothing to do.`)
  }
  const remaining = [
    ...modules.filter(m => m !== target),
    {
      capacityGb: incomingGb,
      removable: true,
      productId: req.incoming.productId,
      slotNumber: target.slotNumber || 1,
    },
  ]
  const afterGb = remaining.reduce((s, m) => s + m.capacityGb, 0)
  return {
    slot: req.slot,
    action,
    beforeGb,
    afterGb,
    remainingModules: remaining,
    removals: [
      {
        kind: 'remove',
        slot: req.slot,
        productId: outgoingProductId,
        productName: req.outgoingProductName,
        capacityGb: target.capacityGb,
        installationId: target.installationId,
        slotNumber: target.slotNumber || 1,
      },
    ],
    installations: [
      {
        kind: 'install',
        slot: req.slot,
        productId: req.incoming.productId,
        productName: req.incoming.productName,
        capacityGb: incomingGb,
        slotNumber: target.slotNumber || 1,
      },
    ],
    storageType: req.incoming ? req.storageType : req.storageType,
  }
}

export function inferTransactionType(ram: BenchSlotResult, storage: BenchSlotResult): ReconfigTransactionType {
  const ramDelta = ram.action === 'none' ? 0 : ram.afterGb - ram.beforeGb
  const storDelta = storage.action === 'none' ? 0 : storage.afterGb - storage.beforeGb
  if (ramDelta < 0 && storDelta <= 0) return 'downgrade_for_sale'
  if (storDelta < 0 && ramDelta <= 0) return 'downgrade_for_sale'
  if (ramDelta > 0 && storDelta >= 0) return 'upgrade_for_sale'
  if (storDelta > 0 && ramDelta >= 0) return 'upgrade_for_sale'
  if (ramDelta !== 0 || storDelta !== 0) return 'configuration_correction'
  return 'configuration_correction'
}

function describeSlot(result: BenchSlotResult): string | null {
  const label = SLOT_LABEL[result.slot]
  if (result.action === 'none') return null
  if (result.action === 'pull_one') {
    return `Pull one ${label} (${result.beforeGb}GB → ${result.afterGb}GB)`
  }
  if (result.action === 'add_one') {
    return `Add ${label} (${result.beforeGb}GB → ${result.afterGb}GB)`
  }
  return `Swap ${label} (${result.beforeGb}GB → ${result.afterGb}GB)`
}

export function describeBenchJob(ram: BenchSlotResult, storage: BenchSlotResult): string {
  return [describeSlot(ram), describeSlot(storage)].filter(Boolean).join('. ') || 'Reconfiguration'
}

export function applyBenchJob(params: {
  productName?: string | null
  brand?: string | null
  model?: string | null
  current: Pick<
    DeviceConfigFields,
    'processor' | 'processorGeneration' | 'totalRamGb' | 'primaryStorageGb' | 'storageType' | 'ramComposition' | 'displayName'
  >
  ram: Omit<BenchSlotRequest, 'slot'> & { slot?: BenchSlot }
  storage: Omit<BenchSlotRequest, 'slot'> & { slot?: BenchSlot }
}): BenchJobResult {
  const ram = applyBenchSlot({ ...params.ram, slot: 'ram' })
  const storage = applyBenchSlot({
    ...params.storage,
    slot: 'storage',
    storageType: params.storage.storageType ?? params.current.storageType,
  })

  const beforeName =
    params.current.displayName ||
    buildDisplayName({
      brand: params.brand,
      model: params.model,
      productName: params.productName,
      config: {
        processor: params.current.processor,
        processorGeneration: params.current.processorGeneration,
        totalRamGb: params.current.totalRamGb || 0,
        ramComposition: params.current.ramComposition || [],
        primaryStorageGb: params.current.primaryStorageGb,
        storageType: params.current.storageType,
      },
    })

  const afterRam = ram.action === 'none' ? (params.current.totalRamGb || ram.beforeGb) : ram.afterGb
  const afterStorage =
    storage.action === 'none'
      ? (params.current.primaryStorageGb || storage.beforeGb)
      : storage.afterGb
  const afterType =
    storage.action === 'none'
      ? params.current.storageType || null
      : storage.storageType || params.current.storageType || 'SSD'

  const afterName = benchUnitName({
    productName: params.productName,
    brand: params.brand,
    model: params.model,
    current: params.current,
    ramGb: afterRam,
    storageGb: afterStorage || 0,
    storageType: afterType,
  })

  const result: BenchJobResult = {
    ram,
    storage,
    before: {
      ramGb: params.current.totalRamGb || ram.beforeGb,
      storageGb: params.current.primaryStorageGb || storage.beforeGb || 0,
      displayName: beforeName,
    },
    after: {
      ramGb: afterRam,
      storageGb: afterStorage || 0,
      displayName: afterName,
      storageType: afterType,
    },
    transactionType: inferTransactionType(ram, storage),
    reason: describeBenchJob(ram, storage),
  }

  if (ram.error) result.error = ram.error
  else if (storage.error) result.error = storage.error
  else if (ram.action === 'none' && storage.action === 'none') {
    result.error = 'Pick a RAM or SSD action — pull one, swap, or add.'
  } else if (ram.afterGb === ram.beforeGb && storage.afterGb === storage.beforeGb) {
    result.error = 'That action does not change RAM or storage.'
  }

  return result
}
