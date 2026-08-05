/**
 * Compatibility checks for device reconfiguration.
 */

import type { CompatibilityIssue, InstalledComponentView, TargetConfigInput } from './types'

export interface ComponentProductSpec {
  id: string
  name: string
  category?: string
  /** Structured attrs from Product.specs JSON */
  capacityGb?: number
  technology?: string
  formFactor?: string
  interface?: string
  speedMhz?: number
  ecc?: boolean
  voltage?: string
  slotType?: string
}

export interface DeviceCapability {
  maxRamGb?: number
  ramSlots?: number
  ramType?: string
  ramSpeedMhz?: number
  eccRequired?: boolean
  storageInterfaces?: string[]
  m2Slots?: number
  sataBays?: number
  maxStorageGb?: number
}

export function checkCompatibility(params: {
  installed: InstalledComponentView[]
  target: TargetConfigInput
  ramProduct?: ComponentProductSpec | null
  storageProduct?: ComponentProductSpec | null
  deviceCapability?: DeviceCapability | null
  issuesFromDiff?: CompatibilityIssue[]
}): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [...(params.issuesFromDiff || [])]
  const caps = params.deviceCapability || {}

  if (caps.maxRamGb && params.target.totalRamGb > caps.maxRamGb) {
    issues.push({
      code: 'exceeds_max_ram',
      severity: 'error',
      message: `Target RAM ${params.target.totalRamGb}GB exceeds device maximum ${caps.maxRamGb}GB.`,
      overridable: true,
    })
  }

  const activeRamSlots = params.installed.filter(
    i => i.status === 'installed' && i.slotType === 'ram_slot',
  ).length
  if (caps.ramSlots && params.target.additiveRam && activeRamSlots >= caps.ramSlots) {
    issues.push({
      code: 'no_free_ram_slot',
      severity: 'error',
      message: `All ${caps.ramSlots} RAM slots are occupied. Remove a module or use a replacement upgrade.`,
      overridable: false,
    })
  }

  if (params.ramProduct) {
    if (caps.ramType && params.ramProduct.technology && caps.ramType !== params.ramProduct.technology) {
      issues.push({
        code: 'ram_type_mismatch',
        severity: 'error',
        message: `RAM technology ${params.ramProduct.technology} is incompatible with required ${caps.ramType}.`,
        overridable: true,
      })
    }
    if (
      caps.eccRequired != null &&
      params.ramProduct.ecc != null &&
      caps.eccRequired !== params.ramProduct.ecc
    ) {
      issues.push({
        code: 'ram_ecc_mismatch',
        severity: 'error',
        message: caps.eccRequired
          ? 'Device requires ECC RAM.'
          : 'Device does not support ECC RAM.',
        overridable: true,
      })
    }
    if (
      params.ramProduct.capacityGb &&
      params.target.ramProductId === params.ramProduct.id &&
      !params.target.additiveRam &&
      params.ramProduct.capacityGb !== params.target.totalRamGb &&
      // allow when soldered remainder exists — diff engine sets requiredCapacityGb separately
      false
    ) {
      /* no-op placeholder kept for clarity */
    }
  }

  if (params.storageProduct) {
    if (
      caps.storageInterfaces?.length &&
      params.storageProduct.interface &&
      !caps.storageInterfaces.includes(params.storageProduct.interface)
    ) {
      issues.push({
        code: 'storage_interface_mismatch',
        severity: 'error',
        message: `Storage interface ${params.storageProduct.interface} is not supported (allowed: ${caps.storageInterfaces.join(', ')}).`,
        overridable: true,
      })
    }
    if (caps.maxStorageGb && params.target.primaryStorageGb > caps.maxStorageGb) {
      issues.push({
        code: 'exceeds_max_storage',
        severity: 'error',
        message: `Target storage ${params.target.primaryStorageGb}GB exceeds device maximum ${caps.maxStorageGb}GB.`,
        overridable: true,
      })
    }
  }

  // Deduplicate by code
  const seen = new Set<string>()
  return issues.filter(i => {
    if (seen.has(i.code)) return false
    seen.add(i.code)
    return true
  })
}

export function hasBlockingCompatibilityIssues(
  issues: CompatibilityIssue[],
  opts?: { allowOverride?: boolean },
): boolean {
  return issues.some(i => {
    if (i.severity !== 'error') return false
    if (opts?.allowOverride && i.overridable) return false
    return true
  })
}
