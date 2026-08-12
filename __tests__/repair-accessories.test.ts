import { describe, expect, it } from 'vitest'
import {
  accessoryMatchesLabelName,
  isLabelAccessoryReceived,
  mergeRepairCreatePreserveIntake,
  REPAIR_LABEL_ACCESSORIES,
} from '@/lib/repair-accessories'

describe('repair accessories ↔ label matching', () => {
  it('matches intake aliases onto label checkboxes', () => {
    expect(accessoryMatchesLabelName('Charger / Adapter', 'Adapter')).toBe(true)
    expect(accessoryMatchesLabelName('Laptop Bag', 'Bag')).toBe(true)
    expect(accessoryMatchesLabelName('External HDD', 'Hard Disk')).toBe(true)
    expect(accessoryMatchesLabelName('Keyboard', 'Keyboard')).toBe(true)
    expect(accessoryMatchesLabelName('Mouse', 'Adapter')).toBe(false)
  })

  it('ticks label boxes from received accessories', () => {
    const accessories = [
      { name: 'Charger / Adapter', received: true },
      { name: 'Laptop Bag', received: true },
      { name: 'Mouse', received: true },
    ]
    expect(isLabelAccessoryReceived(accessories, 'Adapter')).toBe(true)
    expect(isLabelAccessoryReceived(accessories, 'Bag')).toBe(true)
    expect(isLabelAccessoryReceived(accessories, 'Keyboard')).toBe(false)
    expect(isLabelAccessoryReceived([{ name: 'Adapter', received: false }], 'Adapter')).toBe(false)
  })

  it('covers every label accessory name exactly', () => {
    for (const name of REPAIR_LABEL_ACCESSORIES) {
      expect(accessoryMatchesLabelName(name, name)).toBe(true)
    }
  })
})

describe('mergeRepairCreatePreserveIntake', () => {
  it('keeps direct_repair + accessories when a bare create shell arrives later', () => {
    const enriched = {
      id: 'r1',
      repairPath: 'direct_repair',
      accessories: [{ name: 'Adapter', received: true }],
      notes: '[Direct Repair Consent] Signed by: Ada',
      liabilityWaiverAccepted: true,
    }
    const shell = {
      id: 'r1',
      repairPath: 'diagnosis_first',
      accessories: [],
      notes: '',
    }
    const merged = mergeRepairCreatePreserveIntake(enriched, shell)
    expect(merged.repairPath).toBe('direct_repair')
    expect(merged.accessories).toEqual([{ name: 'Adapter', received: true }])
    expect(merged.notes).toContain('Direct Repair Consent')
    expect(merged.liabilityWaiverAccepted).toBe(true)
  })

  it('adopts direct_repair from the incoming create when local was still a shell', () => {
    const shell = { id: 'r1', repairPath: 'diagnosis_first', accessories: [] as { name: string; received: boolean }[] }
    const incoming = {
      id: 'r1',
      repairPath: 'direct_repair' as const,
      accessories: [{ name: 'Bag', received: true }],
      liabilityWaiverAccepted: true,
    }
    const merged = mergeRepairCreatePreserveIntake(shell, incoming)
    expect(merged.repairPath).toBe('direct_repair')
    expect(merged.accessories).toEqual([{ name: 'Bag', received: true }])
  })
})
