import { describe, expect, it } from 'vitest'
import {
  canTransitionRepair,
  evaluateRepairTransition,
  isRepairOperationalStatus,
} from '@/lib/repair-transition-policy'

describe('Repair transition policy', () => {
  it.each([
    ['pending_verification', 'received'],
    ['received', 'assigned'],
    ['assigned', 'diagnosed'],
    ['diagnosed', 'awaiting_approval'],
    ['awaiting_approval', 'approved'],
    ['approved', 'in_repair'],
    ['in_repair', 'qc'],
    ['qc', 'ready'],
    ['ready', 'verified_released'],
    ['verified_released', 'collected'],
    ['collected', 'closed'],
  ])('allows %s → %s', (from, to) => {
    expect(canTransitionRepair(from, to)).toBe(true)
  })

  it.each([
    ['received', 'ready'],
    ['assigned', 'closed'],
    ['qc', 'closed'],
    ['ready', 'invoiced'],
    ['closed', 'received'],
    ['cancelled', 'assigned'],
  ])('rejects %s → %s', (from, to) => {
    expect(canTransitionRepair(from, to)).toBe(false)
  })

  it('keeps invoicing outside the operational Repair state machine', () => {
    expect(isRepairOperationalStatus('invoiced')).toBe(false)
    expect(isRepairOperationalStatus('ready')).toBe(true)
    expect(evaluateRepairTransition('ready', 'invoiced')).toEqual({
      allowed: false,
      reason: 'Invalid Repair transition: ready → invoiced',
    })
  })

  it('supports the explicit QC rework loop', () => {
    expect(canTransitionRepair('qc', 'in_repair')).toBe(true)
  })

  it('supports the explicit ORC void rewind only', () => {
    expect(canTransitionRepair('verified_released', 'ready')).toBe(true)
    expect(canTransitionRepair('delivered', 'ready')).toBe(false)
  })
})
