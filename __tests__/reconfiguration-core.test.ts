import { describe, expect, it } from 'vitest'
import { calculateConfigurationDiff } from '@/lib/reconfiguration/diff-engine'
import { checkCompatibility, hasBlockingCompatibilityIssues } from '@/lib/reconfiguration/compatibility'
import {
  calculateMargin,
  calculateReconfigCost,
  calculateRecommendedSellingPrice,
  calculateUpgradeCharge,
  isBelowMinimumMargin,
  reconfigCompletionEventKey,
} from '@/lib/reconfiguration/costing'
import { buildDisplayName, buildSpecsString, parseSpecsString } from '@/lib/reconfiguration/display-name'
import { canTransition, nextStatus } from '@/lib/reconfiguration/state-machine'
import type { InstalledComponentView } from '@/lib/reconfiguration/types'
import { planComponentInstall, planComponentRemoval, isSellableLocation } from '@/lib/inventory/reconfiguration-stock'

function ram(id: string, gb: number, slot: number, opts?: Partial<InstalledComponentView>): InstalledComponentView {
  return {
    id,
    componentProductId: `prod-ram-${gb}`,
    category: 'ram',
    slotType: 'ram_slot',
    slotNumber: slot,
    capacityGb: gb,
    quantity: 1,
    removable: true,
    status: 'installed',
    costAtInstallation: gb * 10,
    ...opts,
  }
}

function ssd(id: string, gb: number, opts?: Partial<InstalledComponentView>): InstalledComponentView {
  return {
    id,
    componentProductId: `prod-ssd-${gb}`,
    category: 'storage',
    slotType: 'm2_slot',
    slotNumber: 1,
    capacityGb: gb,
    quantity: 1,
    removable: true,
    status: 'installed',
    costAtInstallation: gb * 0.5,
    ...opts,
  }
}

describe('display-name', () => {
  it('builds structured product display names', () => {
    const name = buildDisplayName({
      brand: 'Lenovo',
      model: 'ThinkPad T14',
      config: {
        processor: 'Intel Core i5',
        processorGeneration: '10th Gen',
        totalRamGb: 8,
        ramComposition: [],
        primaryStorageGb: 256,
        storageType: 'SSD',
      },
    })
    expect(name).toBe('Lenovo ThinkPad T14 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD')
  })

  it('parses legacy free-text specs', () => {
    const parsed = parseSpecsString('Intel Core i5, 16GB RAM, 512GB SSD')
    expect(parsed.totalRamGb).toBe(16)
    expect(parsed.primaryStorageGb).toBe(512)
    expect(parsed.storageType).toMatch(/SSD/i)
  })

  it('builds delivery-note specs string', () => {
    expect(
      buildSpecsString({
        processor: 'Intel Core i5',
        processorGeneration: '10th Gen',
        totalRamGb: 8,
        ramComposition: [{ slotType: 'ram_slot', slotNumber: 1, capacityGb: 8, removable: true }],
        primaryStorageGb: 256,
        storageType: 'SSD',
      }),
    ).toContain('8GB RAM')
  })
})

describe('diff-engine downgrade 16/512 → 8/256', () => {
  it('plans removal of 16GB RAM and 512GB SSD and install of replacements', () => {
    const installed = [ram('i1', 16, 1), ssd('i2', 512)]
    const diff = calculateConfigurationDiff({
      installed,
      current: { totalRamGb: 16, primaryStorageGb: 512, ramComposition: [], displayName: '' },
      target: {
        totalRamGb: 8,
        primaryStorageGb: 256,
        ramProductId: 'prod-ram-8',
        storageProductId: 'prod-ssd-256',
      },
      productName: 'ThinkPad T14',
    })

    expect(diff.removals.map(r => r.installationId).sort()).toEqual(['i1', 'i2'])
    expect(diff.installations).toHaveLength(2)
    expect(diff.installations.find(i => i.category === 'ram')?.requiredCapacityGb).toBe(8)
    expect(diff.installations.find(i => i.category === 'storage')?.requiredCapacityGb).toBe(256)
    expect(diff.proposed.totalRamGb).toBe(8)
    expect(diff.proposed.primaryStorageGb).toBe(256)
    expect(diff.issues.some(i => i.code === 'storage_data_handling')).toBe(true)
  })

  it('blocks soldered RAM downgrade', () => {
    const installed = [ram('i1', 16, 1, { removable: false })]
    const diff = calculateConfigurationDiff({
      installed,
      current: { totalRamGb: 16, ramComposition: [], displayName: '' },
      target: { totalRamGb: 8, primaryStorageGb: 256 },
    })
    expect(diff.issues.some(i => i.code === 'soldered_ram_cannot_downgrade')).toBe(true)
    expect(hasBlockingCompatibilityIssues(diff.issues)).toBe(true)
  })
})

describe('diff-engine upgrade / additive', () => {
  it('supports additive RAM without removals', () => {
    const installed = [ram('i1', 8, 1)]
    const diff = calculateConfigurationDiff({
      installed,
      current: { totalRamGb: 8, primaryStorageGb: 256, ramComposition: [], displayName: '' },
      target: {
        totalRamGb: 16,
        primaryStorageGb: 256,
        additiveRam: true,
        ramProductId: 'prod-ram-8',
      },
    })
    expect(diff.removals).toHaveLength(0)
    expect(diff.installations).toHaveLength(1)
    expect(diff.installations[0].targetSlotNumber).toBe(2)
    expect(diff.proposed.totalRamGb).toBe(16)
  })

  it('upgrade 8/256 → 16/512 replaces removable modules', () => {
    const installed = [ram('i1', 8, 1), ssd('i2', 256)]
    const diff = calculateConfigurationDiff({
      installed,
      current: { totalRamGb: 8, primaryStorageGb: 256, ramComposition: [], displayName: '' },
      target: {
        totalRamGb: 16,
        primaryStorageGb: 512,
        ramProductId: 'prod-ram-16',
        storageProductId: 'prod-ssd-512',
      },
    })
    expect(diff.removals).toHaveLength(2)
    expect(diff.installations).toHaveLength(2)
  })
})

describe('compatibility', () => {
  it('flags max RAM exceeded as overridable error', () => {
    const issues = checkCompatibility({
      installed: [],
      target: { totalRamGb: 64, primaryStorageGb: 512 },
      deviceCapability: { maxRamGb: 32 },
    })
    expect(issues.some(i => i.code === 'exceeds_max_ram' && i.overridable)).toBe(true)
  })
})

describe('costing & pricing', () => {
  it('recalculates device cost for downgrade', () => {
    const result = calculateReconfigCost({
      costBefore: 50000,
      costRemoved: 8000,
      costInstalled: 3000,
      labourCost: 500,
    })
    expect(result.costAfter).toBe(45500)
    expect(result.blocked).toBe(false)
  })

  it('blocks negative cost without override', () => {
    const result = calculateReconfigCost({
      costBefore: 1000,
      costRemoved: 5000,
      costInstalled: 0,
    })
    expect(result.blocked).toBe(true)
  })

  it('enforces minimum margin', () => {
    const margin = calculateMargin({ sellingPrice: 10000, costAfter: 9500 })
    expect(margin.grossMarginPct).toBe(5)
    expect(isBelowMinimumMargin({ grossMarginPct: margin.grossMarginPct, minMarginPct: 10 })).toBe(true)
  })

  it('supports cost-plus selling price', () => {
    const price = calculateRecommendedSellingPrice({
      method: 'cost_plus',
      costAfter: 40000,
      markupPct: 25,
    })
    expect(price.recommended).toBe(50000)
  })

  it('calculates customer-paid upgrade charge with trade-in', () => {
    expect(
      calculateUpgradeCharge({
        installedComponentsSellingPrice: 12000,
        labourCharge: 1500,
        approvedTradeInValue: 2000,
      }),
    ).toBe(11500)
  })

  it('builds idempotent completion keys', () => {
    expect(reconfigCompletionEventKey('abc')).toBe('RCF-COMPLETE:abc')
  })
})

describe('state machine', () => {
  it('allows draft → pending_stock_check → reserved → approval → complete path', () => {
    expect(nextStatus('draft', 'submit_stock_check')).toBe('pending_stock_check')
    expect(nextStatus('pending_stock_check', 'reserve')).toBe('components_reserved')
    expect(nextStatus('components_reserved', 'submit_approval')).toBe('pending_approval')
    expect(nextStatus('pending_approval', 'approve')).toBe('approved')
    expect(nextStatus('approved', 'start')).toBe('in_progress')
    expect(nextStatus('in_progress', 'submit_qa')).toBe('pending_qa')
    expect(nextStatus('pending_qa', 'complete')).toBe('completed')
    expect(canTransition('completed', 'complete')).toBe(false)
    expect(canTransition('completed', 'reverse')).toBe(true)
  })
})

describe('stock planners', () => {
  it('routes removed components to pending_testing by default', () => {
    const plan = planComponentRemoval({
      documentRef: 'RCF/2026/0001',
      productId: 'p1',
      productName: '16GB RAM',
      qty: 1,
      disposition: 'pending_testing',
    })
    expect(plan.kind).toBe('return_bulk_to_testing')
    if (plan.kind === 'return_bulk_to_testing') expect(plan.to).toBe('pending_testing')
  })

  it('plans bulk consume for installs', () => {
    const plan = planComponentInstall({
      documentRef: 'RCF/2026/0001',
      productId: 'p2',
      productName: '8GB RAM',
      qty: 1,
      from: 'warehouse',
    })
    expect(plan.kind).toBe('consume_bulk')
  })

  it('excludes quarantine from sellable locations', () => {
    expect(isSellableLocation('warehouse')).toBe(true)
    expect(isSellableLocation('pending_testing')).toBe(false)
    expect(isSellableLocation('quarantine')).toBe(false)
  })
})
