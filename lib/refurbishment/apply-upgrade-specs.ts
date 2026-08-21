/**
 * Refurbishment (REF/…) is not the reconfiguration bench.
 *
 * Fitting RAM or an SSD on a REF job must update the *unit* selling name so
 * quotes, POS, labels, and invoices show the machine as it now is. The catalog
 * Product.name / SKU is left alone — other units on that SKU may still be 4GB.
 *
 * Each RAM/SSD part records how it was fitted:
 *   add  — leave what is in the machine, fit this next to it (4GB + 8GB → 12GB)
 *   swap — pull the old module, put this in (4GB → 8GB)
 *
 * When the tech has not picked yet: RAM defaults to add, storage defaults to swap
 * (typical HDD → SSD).
 */

import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import { isRamComponentProduct, isStorageComponentProduct } from '@/lib/reconfiguration/part-catalog'
import {
  mergeEffectsIntoTarget,
  parseProductReconfigEffect,
  type ProductReconfigEffect,
} from '@/lib/reconfiguration/product-effect'
import { unitSellingName } from '@/lib/reconfiguration/unit-selling-name'

export type RefurbInstallAction = 'add' | 'swap'
export type RefurbCapacitySlot = 'ram' | 'storage'

export type RefurbNamePart = {
  partName: string
  productId?: string
  status: string
  qty?: number
  installAction?: RefurbInstallAction
}

export type RefurbNameProduct = {
  id: string
  name?: string | null
  category?: string | null
  specs?: unknown
  trackingMethod?: string | null
  requiresSerial?: boolean | null
}

const SKIP_PART_STATUSES = new Set(['ordered', 'requested'])

export type RefurbUpgradeNameResult = {
  sellingName: string
  specs: string
  specsAtIntake: string
  ramGb: number
  storageGb: number
  storageType: string | null
}

function firstCapacityGb(name: string): number | undefined {
  const tb = String(name || '').match(/(\d+(?:\.\d+)?)\s*TB\b/i)
  if (tb) return Math.round(Number(tb[1]) * 1024)
  const gb = String(name || '').match(/(\d+)\s*GB\b/i)
  if (gb) {
    const n = Number(gb[1])
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  return undefined
}

function qtyOf(part: RefurbNamePart): number {
  const n = Number(part.qty)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1
}

function probeFromPart(
  part: Pick<RefurbNamePart, 'partName' | 'productId'>,
  products: RefurbNameProduct[] | undefined,
) {
  const linked = part.productId ? (products || []).find(p => p.id === part.productId) : undefined
  const name = String(linked?.name || part.partName || '').trim()
  return {
    linked,
    name,
    probe: {
      id: linked?.id || part.productId || `refurb-part:${name}`,
      name,
      category: linked?.category,
      specs: linked?.specs,
      trackingMethod: linked?.trackingMethod,
      requiresSerial: linked?.requiresSerial,
    },
  }
}

export function refurbPartCapacitySlot(
  part: Pick<RefurbNamePart, 'partName' | 'productId'>,
  products?: RefurbNameProduct[],
): RefurbCapacitySlot | null {
  const { probe, name } = probeFromPart(part, products)
  if (!name) return null
  const parsed = parseProductReconfigEffect(probe)
  if (parsed?.slot === 'storage') return 'storage'
  if (parsed?.slot === 'ram' || parsed?.slot === 'both') return 'ram'
  if (isRamComponentProduct(probe)) return 'ram'
  if (isStorageComponentProduct(probe)) return 'storage'
  return null
}

export function defaultRefurbInstallAction(slot: RefurbCapacitySlot): RefurbInstallAction {
  return slot === 'ram' ? 'add' : 'swap'
}

export function resolveRefurbInstallAction(
  part: Pick<RefurbNamePart, 'installAction'>,
  slot: RefurbCapacitySlot,
): RefurbInstallAction {
  if (part.installAction === 'add' || part.installAction === 'swap') return part.installAction
  return defaultRefurbInstallAction(slot)
}

export function refurbInstallActionLabel(action: RefurbInstallAction): string {
  return action === 'add' ? 'Add next to existing' : 'Swap (take the old one out)'
}

/** RAM/SSD parts that have actually reached the bench (not still on order). */
export function refurbPartsThatChangeSpecs(parts: RefurbNamePart[] | null | undefined): RefurbNamePart[] {
  return (parts || []).filter(part => !SKIP_PART_STATUSES.has(String(part.status || 'needed')))
}

function effectFromRefurbPart(
  part: RefurbNamePart,
  products: RefurbNameProduct[] | undefined,
): ProductReconfigEffect | null {
  const slot = refurbPartCapacitySlot(part, products)
  if (!slot) return null
  const { probe, name } = probeFromPart(part, products)
  const parsed = parseProductReconfigEffect(probe)
  const gb = (parsed?.addRamGb || parsed?.targetRamGb || parsed?.targetStorageGb || parsed?.addStorageGb || firstCapacityGb(name) || 0) * qtyOf(part)
  if (gb <= 0) return null
  const action = resolveRefurbInstallAction(part, slot)

  if (slot === 'ram') {
    if (action === 'add') {
      return {
        slot: 'ram',
        addRamGb: gb,
        additiveRam: true,
        productId: probe.id,
        productName: name,
        source: parsed?.source || 'name',
      }
    }
    return {
      slot: 'ram',
      targetRamGb: gb,
      productId: probe.id,
      productName: name,
      source: parsed?.source || 'name',
    }
  }

  const storageType = parsed?.storageType || (/hdd/i.test(name) ? 'HDD' : 'SSD')
  if (action === 'add') {
    return {
      slot: 'storage',
      addStorageGb: gb,
      storageType,
      productId: probe.id,
      productName: name,
      source: parsed?.source || 'name',
    }
  }
  return {
    slot: 'storage',
    targetStorageGb: gb,
    storageType,
    productId: probe.id,
    productName: name,
    source: parsed?.source || 'name',
  }
}

export function applyRefurbPartsToUnitName(opts: {
  productName?: string | null
  specs?: string | null
  specsAtIntake?: string | null
  parts: RefurbNamePart[]
  products?: RefurbNameProduct[]
}): RefurbUpgradeNameResult | null {
  const specsAtIntake = String(opts.specsAtIntake || opts.specs || '').trim()
  const productName = String(opts.productName || '').trim()
  const effects = refurbPartsThatChangeSpecs(opts.parts)
    .map(part => effectFromRefurbPart(part, opts.products))
    .filter((row): row is ProductReconfigEffect => Boolean(row))

  if (!effects.length) return null

  const parsed = parseSpecsString(specsAtIntake || productName)
  const target = mergeEffectsIntoTarget({
    current: {
      totalRamGb: Number(parsed.totalRamGb) || 0,
      primaryStorageGb: parsed.primaryStorageGb,
      storageType: parsed.storageType,
      processor: parsed.processor,
      processorGeneration: parsed.processorGeneration,
    },
    effects,
  })
  if (!target) return null

  const sellingName = unitSellingName({
    productName,
    specs: specsAtIntake || productName,
    totalRamGb: target.totalRamGb,
    primaryStorageGb: target.primaryStorageGb,
    storageType: target.storageType,
    processor: target.processor,
    processorGeneration: target.processorGeneration,
  })

  return {
    sellingName,
    specs: sellingName,
    specsAtIntake: specsAtIntake || productName,
    ramGb: target.totalRamGb,
    storageGb: Number(target.primaryStorageGb) || 0,
    storageType: target.storageType || null,
  }
}

/** Resolve intake specs then apply RAM/SSD parts logged on a REF job. */
export function refurbishmentSellingNamePatch(opts: {
  job: {
    productName: string
    specs?: string
    specsAtIntake?: string
    partsNeeded: RefurbNamePart[]
  }
  serial?: { productName?: string; specs?: string } | null
  products?: RefurbNameProduct[]
}): RefurbUpgradeNameResult | null {
  // Empty string is a valid freeze — do not fall through to the after-name.
  const specsAtIntake = typeof opts.job.specsAtIntake === 'string'
    ? opts.job.specsAtIntake
    : String(opts.job.specs || opts.serial?.specs || '')
  return applyRefurbPartsToUnitName({
    productName: opts.serial?.productName || opts.job.productName,
    specs: typeof opts.job.specsAtIntake === 'string' ? opts.job.specsAtIntake : (opts.serial?.specs || opts.job.specs),
    specsAtIntake,
    parts: opts.job.partsNeeded || [],
    products: opts.products,
  })
}
