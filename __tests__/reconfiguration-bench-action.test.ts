import { describe, expect, it } from 'vitest'
import { applyBenchJob, applyBenchSlot, modulesFromInstalled, remainingModulesToSeed, reuseSeededInstallId } from '@/lib/reconfiguration/bench-action'
import {
  catalogBaseName,
  rewriteUnitCapacitiesInText,
  unitSellingName,
  cleanUnitDisplayName,
  applyUnitNameToLineDescription,
} from '@/lib/reconfiguration/unit-selling-name'
import { parseSpecsString } from '@/lib/reconfiguration/display-name'
import type { InstalledComponentView } from '@/lib/reconfiguration/types'

function ramInstall(id: string, gb: number, slot: number): InstalledComponentView {
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
    costAtInstallation: 0,
  }
}

function ssdInstall(id: string, gb: number): InstalledComponentView {
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
    costAtInstallation: 0,
  }
}

describe('bench-action RAM', () => {
  it('pull one stick: 2×8 → 8, removed stick goes to parts', () => {
    const result = applyBenchSlot({
      slot: 'ram',
      action: 'pull_one',
      currentTotalGb: 16,
      currentModules: modulesFromInstalled(
        [ramInstall('a', 8, 1), ramInstall('b', 8, 2)],
        'ram',
      ),
      outgoingProductId: 'prod-ram-8',
    })
    expect(result.error).toBeUndefined()
    expect(result.afterGb).toBe(8)
    expect(result.removals).toHaveLength(1)
    expect(result.removals[0].capacityGb).toBe(8)
    expect(result.installations).toHaveLength(0)
    expect(result.remainingModules).toHaveLength(1)
  })

  it('pull one from declared 2 sticks when no component graph exists', () => {
    const result = applyBenchSlot({
      slot: 'ram',
      action: 'pull_one',
      currentTotalGb: 16,
      moduleCount: 2,
      outgoingProductId: 'prod-ram-8',
    })
    expect(result.error).toBeUndefined()
    expect(result.afterGb).toBe(8)
    expect(result.removals[0].productId).toBe('prod-ram-8')
  })

  it('refuses pull-one when only one module is fitted — that is a swap', () => {
    const result = applyBenchSlot({
      slot: 'ram',
      action: 'pull_one',
      currentTotalGb: 16,
      moduleCount: 1,
      outgoingProductId: 'prod-ram-16',
    })
    expect(result.error).toMatch(/swap/i)
  })

  it('swap 16 → 8', () => {
    const result = applyBenchSlot({
      slot: 'ram',
      action: 'swap',
      currentTotalGb: 16,
      moduleCount: 1,
      outgoingProductId: 'prod-ram-16',
      incoming: { productId: 'prod-ram-8', capacityGb: 8 },
    })
    expect(result.error).toBeUndefined()
    expect(result.afterGb).toBe(8)
    expect(result.removals[0].productId).toBe('prod-ram-16')
    expect(result.installations[0].productId).toBe('prod-ram-8')
  })

  it('swap up 8 → 16', () => {
    const result = applyBenchSlot({
      slot: 'ram',
      action: 'swap',
      currentTotalGb: 8,
      moduleCount: 1,
      outgoingProductId: 'prod-ram-8',
      incoming: { productId: 'prod-ram-16', capacityGb: 16 },
    })
    expect(result.afterGb).toBe(16)
  })

  it('add a stick: 8 → 16', () => {
    const result = applyBenchSlot({
      slot: 'ram',
      action: 'add_one',
      currentTotalGb: 8,
      moduleCount: 1,
      incoming: { productId: 'prod-ram-8', capacityGb: 8 },
    })
    expect(result.error).toBeUndefined()
    expect(result.afterGb).toBe(16)
    expect(result.removals).toHaveLength(0)
    expect(result.installations).toHaveLength(1)
  })

  it('add a 4GB stick: 8 → 12', () => {
    const result = applyBenchSlot({
      slot: 'ram',
      action: 'add_one',
      currentTotalGb: 8,
      moduleCount: 1,
      incoming: { productId: 'prod-ram-4', capacityGb: 4, productName: '4GB DDR4 SODIMM Laptop RAM - 2666MHz' },
    })
    expect(result.error).toBeUndefined()
    expect(result.afterGb).toBe(12)
    expect(result.remainingModules).toHaveLength(2)
    const toSeed = remainingModulesToSeed(result.remainingModules, result.installations)
    expect(toSeed).toHaveLength(0)
  })

  it('blocks soldered RAM pull', () => {
    const result = applyBenchSlot({
      slot: 'ram',
      action: 'pull_one',
      currentTotalGb: 16,
      currentModules: [
        { capacityGb: 8, removable: false, slotNumber: 1 },
        { capacityGb: 8, removable: false, slotNumber: 2 },
      ],
      outgoingProductId: 'prod-ram-8',
    })
    expect(result.error).toMatch(/soldered/i)
  })
})

describe('bench-action SSD / storage — same four moves as RAM', () => {
  it('pull one drive: dual 256+256 → 256', () => {
    const result = applyBenchSlot({
      slot: 'storage',
      action: 'pull_one',
      currentTotalGb: 512,
      currentModules: [
        { capacityGb: 256, removable: true, productId: 'ssd-256', slotNumber: 1, installationId: 'd1' },
        { capacityGb: 256, removable: true, productId: 'ssd-256', slotNumber: 2, installationId: 'd2' },
      ],
    })
    expect(result.afterGb).toBe(256)
    expect(result.removals).toHaveLength(1)
    expect(result.installations).toHaveLength(0)
  })

  it('swap 512 → 256', () => {
    const result = applyBenchSlot({
      slot: 'storage',
      action: 'swap',
      currentTotalGb: 512,
      moduleCount: 1,
      outgoingProductId: 'ssd-512',
      incoming: { productId: 'ssd-256', capacityGb: 256 },
      storageType: 'SSD',
    })
    expect(result.afterGb).toBe(256)
    expect(result.removals[0].productId).toBe('ssd-512')
    expect(result.installations[0].productId).toBe('ssd-256')
    expect(result.removals[0].slotNumber).toBe(result.installations[0].slotNumber)
  })

  it('swap up 256 → 512', () => {
    const result = applyBenchSlot({
      slot: 'storage',
      action: 'swap',
      currentTotalGb: 256,
      moduleCount: 1,
      outgoingProductId: 'ssd-256',
      incoming: { productId: 'ssd-512', capacityGb: 512 },
    })
    expect(result.afterGb).toBe(512)
  })

  it('add a drive: 256 → 512', () => {
    const result = applyBenchSlot({
      slot: 'storage',
      action: 'add_one',
      currentTotalGb: 256,
      incoming: { productId: 'ssd-256b', capacityGb: 256 },
    })
    expect(result.afterGb).toBe(512)
    expect(result.installations).toHaveLength(1)
  })
})

describe('bench job RAM + SSD together', () => {
  it('pull RAM stick and swap SSD in one job, rebuilds the unit name', () => {
    const job = applyBenchJob({
      productName: 'HP EliteBook 840 G8 i7 16GB 512GB SSD',
      current: {
        processor: 'Intel Core i7',
        processorGeneration: null,
        totalRamGb: 16,
        ramComposition: [],
        primaryStorageGb: 512,
        storageType: 'SSD',
        displayName: 'HP EliteBook 840 G8 i7 16GB 512GB SSD',
      },
      ram: {
        action: 'pull_one',
        currentTotalGb: 16,
        moduleCount: 2,
        outgoingProductId: 'prod-ram-8',
      },
      storage: {
        action: 'swap',
        currentTotalGb: 512,
        moduleCount: 1,
        outgoingProductId: 'ssd-512',
        incoming: { productId: 'ssd-256', capacityGb: 256 },
        storageType: 'SSD',
      },
    })
    expect(job.error).toBeUndefined()
    expect(job.after.ramGb).toBe(8)
    expect(job.after.storageGb).toBe(256)
    expect(job.after.displayName).toMatch(/8GB/)
    expect(job.after.displayName).toMatch(/256GB SSD/)
    expect(job.after.displayName).not.toMatch(/16GB/)
    expect(job.after.displayName).not.toMatch(/512GB/)
    expect(job.transactionType).toBe('downgrade_for_sale')
    expect(job.reason).toMatch(/RAM/)
    expect(job.reason).toMatch(/SSD/)
  })

  it('add 4GB to 8GB rewrites the EliteBook catalog title to 12GB RAM', () => {
    const job = applyBenchJob({
      productName: 'HP EliteBook 745 G6 - AMD Ryzen 5 PRO 3500U, 8GB RAM, 256GB SSD',
      current: {
        processor: 'AMD Ryzen 5 PRO 3500U',
        processorGeneration: null,
        totalRamGb: 8,
        ramComposition: [],
        primaryStorageGb: 256,
        storageType: 'SSD',
        displayName: 'AMD Ryzen 5 PRO 3500U, 8GB RAM, 256GB SSD',
      },
      ram: {
        action: 'add_one',
        currentTotalGb: 8,
        moduleCount: 1,
        incoming: { productId: 'prod-ram-4', capacityGb: 4 },
      },
      storage: { action: 'none', currentTotalGb: 256, storageType: 'SSD' },
    })
    expect(job.error).toBeUndefined()
    expect(job.after.ramGb).toBe(12)
    expect(job.after.displayName).toBe(
      'HP EliteBook 745 G6 - AMD Ryzen 5 PRO 3500U, 12GB RAM, 256GB SSD',
    )
    expect(job.after.displayName).not.toMatch(/8GB RAM, 256GB SSD -/)
  })

  it('errors when both slots are left alone', () => {
    const job = applyBenchJob({
      productName: 'ThinkPad',
      current: {
        totalRamGb: 16,
        ramComposition: [],
        primaryStorageGb: 512,
        storageType: 'SSD',
        displayName: '',
      },
      ram: { action: 'none', currentTotalGb: 16 },
      storage: { action: 'none', currentTotalGb: 512 },
    })
    expect(job.error).toMatch(/Pick a RAM or SSD action/)
  })
})

describe('unit selling name after reconfig', () => {
  it('rewrites catalog title RAM/SSD and leaves the catalog SKU string as input only', () => {
    const catalog = 'HP EliteBook 840 G8 i7 16GB 512GB SSD'
    expect(rewriteUnitCapacitiesInText(catalog, 8, 256, 'SSD')).toBe(
      'HP EliteBook 840 G8 i7 8GB 256GB SSD',
    )
    expect(catalogBaseName(catalog)).not.toMatch(/16GB/)
  })

  it('prefers live displayName over a stale catalog title', () => {
    expect(
      unitSellingName({
        productName: 'HP EliteBook 840 G8 i7 16GB 512GB SSD',
        displayName: 'HP EliteBook 840 G8 - Intel Core i7, 8GB RAM, 256GB SSD',
        totalRamGb: 8,
        primaryStorageGb: 256,
        storageType: 'SSD',
      }),
    ).toMatch(/8GB RAM/)
  })

  it('rebuilds a concatenated 16GB+8GB title from the catalog SKU', () => {
    expect(
      cleanUnitDisplayName({
        productName: 'HP EliteBook 830 G7 - 10th Gen Intel Core i5, 16GB RAM, 256GB SSD',
        displayName:
          'HP EliteBook 830 G7 - 10th Gen Intel Core i5, 16GB RAM, 256GB SSD - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
        totalRamGb: 8,
        primaryStorageGb: 256,
        storageType: 'SSD',
        processor: 'Intel Core i5',
        processorGeneration: '10th Gen',
      }),
    ).toBe('HP EliteBook 830 G7 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD')
  })

  it('keeps the invoice ×qty suffix when rewriting a line', () => {
    expect(
      applyUnitNameToLineDescription(
        'HP EliteBook 830 G7 - 10th Gen Intel Core i5, 16GB RAM, 256GB SSD ×1',
        'HP EliteBook 830 G7 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD',
      ),
    ).toBe('HP EliteBook 830 G7 - 10th Gen Intel Core i5, 8GB RAM, 256GB SSD ×1')
  })
})

describe('reuseSeededInstallId', () => {
  it('reuses only the same part in a slot, never the drive just fitted', () => {
    expect(reuseSeededInstallId({ id: 'old-128', componentProductId: 'ssd-128' }, 'ssd-128')).toBe('old-128')
    expect(reuseSeededInstallId({ id: 'new-256', componentProductId: 'ssd-256' }, 'ssd-128')).toBeNull()
    expect(reuseSeededInstallId(null, 'ssd-128')).toBeNull()
  })
})

describe('parseSpecsString storage TB', () => {
  it('reads 1TB SSD as 1024GB', () => {
    const parsed = parseSpecsString('i5, 16GB RAM, 1TB SSD')
    expect(parsed.primaryStorageGb).toBe(1024)
    expect(parsed.totalRamGb).toBe(16)
  })
})
