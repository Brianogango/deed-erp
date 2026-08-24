/**
 * Diff current installed components vs target configuration.
 * Distinguishes soldered vs removable modules and additive vs replacement upgrades.
 */

import { buildSpecsString } from './display-name'
import { cleanUnitDisplayName } from './unit-selling-name'
import type {
  CompatibilityIssue,
  DeviceConfigFields,
  DiffResult,
  InstalledComponentView,
  TargetConfigInput,
} from './types'

function sumRam(installed: InstalledComponentView[]): number {
  return installed
    .filter(i => i.status === 'installed' && (i.category === 'ram' || i.slotType === 'ram_slot'))
    .reduce((s, i) => s + (Number(i.capacityGb) || 0) * (i.quantity || 1), 0)
}

function primaryStorage(installed: InstalledComponentView[]): InstalledComponentView | undefined {
  const drives = installed.filter(
    i => i.status === 'installed' && (i.category === 'storage' || i.slotType === 'm2_slot' || i.slotType === 'sata_bay'),
  )
  return drives.sort((a, b) => a.slotNumber - b.slotNumber)[0]
}

function nextFreeSlot(
  installed: InstalledComponentView[],
  slotType: InstalledComponentView['slotType'],
  preferEmptyAfterRemoval: Set<string>,
): number {
  const occupied = new Set(
    installed
      .filter(i => i.status === 'installed' && i.slotType === slotType && !preferEmptyAfterRemoval.has(i.id))
      .map(i => i.slotNumber),
  )
  let n = 1
  while (occupied.has(n)) n += 1
  return n
}

export function calculateConfigurationDiff(params: {
  installed: InstalledComponentView[]
  current: Partial<DeviceConfigFields>
  target: TargetConfigInput
  brand?: string | null
  model?: string | null
  productName?: string | null
}): DiffResult {
  const installed = params.installed.filter(i => i.status === 'installed')
  const issues: CompatibilityIssue[] = []
  const removals: DiffResult['removals'] = []
  const installations: DiffResult['installations'] = []
  const removalIds = new Set<string>()

  const scope = params.target.changeScope || 'both'
  const changeRam = scope === 'ram' || scope === 'both'
  const changeStorage = scope === 'storage' || scope === 'both'

  const ramModules = installed
    .filter(i => i.category === 'ram' || i.slotType === 'ram_slot')
    .sort((a, b) => a.slotNumber - b.slotNumber)
  const currentRam = sumRam(installed) || Number(params.current.totalRamGb) || 0
  // RAM-only / storage-only: freeze the out-of-scope target to the current value
  // so callers can still send both fields without accidentally swapping the other.
  const targetRam = changeRam
    ? Math.max(0, Math.floor(Number(params.target.totalRamGb) || 0))
    : currentRam

  // ── RAM ────────────────────────────────────────────────────────────────────
  if (changeRam && targetRam < currentRam) {
    // Downgrade: remove removable modules until we can meet target, then install if needed
    const removable = ramModules.filter(m => m.removable)
    const soldered = ramModules.filter(m => !m.removable)
    const solderedTotal = soldered.reduce((s, m) => s + (Number(m.capacityGb) || 0), 0)

    if (solderedTotal > targetRam) {
      issues.push({
        code: 'soldered_ram_cannot_downgrade',
        severity: 'error',
        message: `Device has ${solderedTotal}GB soldered/onboard RAM and cannot be downgraded to ${targetRam}GB.`,
        overridable: false,
      })
    } else if (removable.length === 0 && currentRam > targetRam) {
      issues.push({
        code: 'no_removable_ram',
        severity: 'error',
        message: 'No removable RAM modules are recorded. Capture installed components before downgrading.',
        overridable: false,
      })
    } else {
      // Prefer replacing a single module that exceeds target
      let remaining = currentRam
      for (const mod of [...removable].sort((a, b) => (Number(b.capacityGb) || 0) - (Number(a.capacityGb) || 0))) {
        if (remaining <= targetRam) break
        removals.push({
          installationId: mod.id,
          componentProductId: mod.componentProductId,
          slotType: mod.slotType,
          slotNumber: mod.slotNumber,
          capacityGb: mod.capacityGb,
          existingCost: mod.costAtInstallation,
          componentSerialText: mod.componentSerialText,
          category: mod.category,
          removable: mod.removable,
        })
        removalIds.add(mod.id)
        remaining -= Number(mod.capacityGb) || 0
      }

      if (remaining < targetRam) {
        // Need to install a module to reach exact target
        const need = targetRam - remaining
        const slot = removals[0]
          ? { type: removals[0].slotType, number: removals[0].slotNumber }
          : { type: 'ram_slot' as const, number: nextFreeSlot(installed, 'ram_slot', removalIds) }
        installations.push({
          componentProductId: params.target.ramProductId,
          requiredCapacityGb: need,
          category: 'ram',
          targetSlotType: slot.type,
          targetSlotNumber: slot.number,
        })
      } else if (remaining > targetRam) {
        issues.push({
          code: 'ram_downgrade_impossible_composition',
          severity: 'error',
          message: `Cannot reach exactly ${targetRam}GB from current RAM composition without unsupported partial module removal.`,
          overridable: true,
        })
      }
    }
  } else if (changeRam && targetRam > currentRam) {
    const delta = targetRam - currentRam
    if (params.target.additiveRam) {
      installations.push({
        componentProductId: params.target.ramProductId,
        requiredCapacityGb: delta,
        category: 'ram',
        targetSlotType: 'ram_slot',
        targetSlotNumber: nextFreeSlot(installed, 'ram_slot', removalIds),
      })
    } else {
      // Replacement upgrade: remove removable modules and install target module(s)
      const removable = ramModules.filter(m => m.removable)
      if (removable.length === 0 && ramModules.some(m => !m.removable) && currentRam > 0) {
        // Only soldered present — additive is the only path
        installations.push({
          componentProductId: params.target.ramProductId,
          requiredCapacityGb: delta,
          category: 'ram',
          targetSlotType: 'ram_slot',
          targetSlotNumber: nextFreeSlot(installed, 'ram_slot', removalIds),
        })
        issues.push({
          code: 'soldered_ram_additive_only',
          severity: 'warning',
          message: 'Onboard RAM cannot be replaced; upgrade will add a removable module.',
          overridable: true,
        })
      } else {
        for (const mod of removable) {
          removals.push({
            installationId: mod.id,
            componentProductId: mod.componentProductId,
            slotType: mod.slotType,
            slotNumber: mod.slotNumber,
            capacityGb: mod.capacityGb,
            existingCost: mod.costAtInstallation,
            componentSerialText: mod.componentSerialText,
            category: mod.category,
            removable: mod.removable,
          })
          removalIds.add(mod.id)
        }
        const slotNumber = removable[0]?.slotNumber ?? nextFreeSlot(installed, 'ram_slot', removalIds)
        installations.push({
          componentProductId: params.target.ramProductId,
          requiredCapacityGb: targetRam - sumRam(installed.filter(i => !i.removable && (i.category === 'ram' || i.slotType === 'ram_slot'))),
          category: 'ram',
          targetSlotType: 'ram_slot',
          targetSlotNumber: slotNumber,
        })
      }
    }
  }

  // ── Storage ────────────────────────────────────────────────────────────────
  const currentDrive = primaryStorage(installed)
  const currentStorage =
    Number(currentDrive?.capacityGb) || Number(params.current.primaryStorageGb) || 0
  const targetStorage = changeStorage
    ? Math.max(0, Math.floor(Number(params.target.primaryStorageGb) || 0))
    : currentStorage

  if (changeStorage && targetStorage > 0 && targetStorage !== currentStorage) {
    if (currentDrive) {
      if (!currentDrive.removable) {
        issues.push({
          code: 'storage_not_removable',
          severity: 'error',
          message: 'Primary storage is marked non-removable and cannot be swapped.',
          overridable: false,
        })
      } else {
        removals.push({
          installationId: currentDrive.id,
          componentProductId: currentDrive.componentProductId,
          slotType: currentDrive.slotType,
          slotNumber: currentDrive.slotNumber,
          capacityGb: currentDrive.capacityGb,
          existingCost: currentDrive.costAtInstallation,
          componentSerialText: currentDrive.componentSerialText,
          category: currentDrive.category,
          removable: currentDrive.removable,
        })
        removalIds.add(currentDrive.id)
        issues.push({
          code: 'storage_data_handling',
          severity: 'warning',
          message: 'Removed storage requires a data-status confirmation and sanitisation before return to sellable stock.',
          overridable: false,
        })
        installations.push({
          componentProductId: params.target.storageProductId,
          requiredCapacityGb: targetStorage,
          category: 'storage',
          targetSlotType: currentDrive.slotType,
          targetSlotNumber: currentDrive.slotNumber,
          technology: params.target.storageType || undefined,
        })
      }
    } else {
      // No recorded drive — install into M.2 slot 1
      installations.push({
        componentProductId: params.target.storageProductId,
        requiredCapacityGb: targetStorage,
        category: 'storage',
        targetSlotType: 'm2_slot',
        targetSlotNumber: 1,
        technology: params.target.storageType || undefined,
      })
      if (currentStorage > 0) {
        issues.push({
          code: 'storage_install_without_recorded_removal',
          severity: 'warning',
          message: 'Current storage is not recorded as an installed component. Confirm physical removal before installing the replacement.',
          overridable: true,
        })
      }
    }
  }

  if (removals.length === 0 && installations.length === 0) {
    issues.push({
      code: 'no_component_changes',
      severity: 'error',
      message:
        scope === 'ram'
          ? 'RAM-only scope selected but target RAM matches the current configuration.'
          : scope === 'storage'
            ? 'Storage-only scope selected but target storage matches the current configuration.'
            : 'Target configuration matches the current device — nothing to reconfigure.',
      overridable: false,
    })
  }

  const remainingRamModules = installed.filter(
    i => (i.category === 'ram' || i.slotType === 'ram_slot') && !removalIds.has(i.id),
  )
  const proposedRamComposition = [
    ...remainingRamModules.map(m => ({
      slotType: m.slotType,
      slotNumber: m.slotNumber,
      capacityGb: Number(m.capacityGb) || 0,
      technology: m.technology || undefined,
      removable: m.removable,
      productId: m.componentProductId,
      installationId: m.id,
      componentSerialText: m.componentSerialText || undefined,
    })),
    ...installations
      .filter(i => i.category === 'ram')
      .map(i => ({
        slotType: i.targetSlotType,
        slotNumber: i.targetSlotNumber,
        capacityGb: i.requiredCapacityGb,
        technology: i.technology,
        removable: true,
        productId: i.componentProductId,
      })),
  ]

  const proposedRamTotal =
    proposedRamComposition.reduce((s, e) => s + e.capacityGb, 0) || targetRam

  const proposed: DeviceConfigFields = {
    processor: params.target.processor ?? params.current.processor ?? null,
    processorGeneration: params.target.processorGeneration ?? params.current.processorGeneration ?? null,
    totalRamGb: proposedRamTotal,
    ramComposition: proposedRamComposition,
    primaryStorageGb: targetStorage || params.current.primaryStorageGb || null,
    secondaryStorageGb: params.target.secondaryStorageGb ?? params.current.secondaryStorageGb ?? null,
    storageType: changeStorage
      ? (params.target.storageType ?? params.current.storageType ?? 'SSD')
      : (params.current.storageType ?? 'SSD'),
    screenSize: params.current.screenSize ?? null,
    screenResolution: params.current.screenResolution ?? null,
    touchscreen: params.current.touchscreen ?? null,
    graphics: params.current.graphics ?? null,
    operatingSystem: params.current.operatingSystem ?? null,
    keyboardLayout: params.current.keyboardLayout ?? null,
    colour: params.current.colour ?? null,
    includedAccessories: params.current.includedAccessories ?? [],
    batteryCondition: params.current.batteryCondition ?? null,
    grade: params.current.grade ?? null,
    displayName: '',
  }
  proposed.displayName = cleanUnitDisplayName({
    brand: params.brand,
    model: params.model,
    productName: params.productName,
    displayName: params.current.displayName,
    processor: proposed.processor,
    processorGeneration: proposed.processorGeneration,
    totalRamGb: proposed.totalRamGb,
    primaryStorageGb: proposed.primaryStorageGb,
    storageType: proposed.storageType,
  })

  return { removals, installations, proposed, issues }
}

export function specsFromProposed(proposed: DeviceConfigFields): string {
  return buildSpecsString(proposed)
}
