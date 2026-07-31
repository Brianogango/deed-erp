import { describe, it, expect } from 'vitest'
import { getPreviousRepairProgressStatus, repairProgressOrderFor } from '@/lib/repair-progress'

describe('getPreviousRepairProgressStatus', () => {
  it('moves diagnosed back to assigned', () => {
    expect(getPreviousRepairProgressStatus({ status: 'diagnosed' })).toBe('assigned')
  })

  it('does not ping-pong after a prior back-step history pattern', () => {
    expect(getPreviousRepairProgressStatus({
      status: 'diagnosed',
      repairPath: 'diagnosis_first',
    })).toBe('assigned')
    expect(getPreviousRepairProgressStatus({
      status: 'assigned',
      repairPath: 'diagnosis_first',
    })).toBe('received')
  })

  it('skips diagnosed/approval for direct_repair path', () => {
    expect(getPreviousRepairProgressStatus({
      status: 'in_repair',
      repairPath: 'direct_repair',
    })).toBe('assigned')
    expect(getPreviousRepairProgressStatus({
      status: 'diagnosed',
      repairPath: 'direct_repair',
    })).toBe('assigned')
  })

  it('skips awaiting_parts when no procurement exists', () => {
    expect(getPreviousRepairProgressStatus({
      status: 'in_repair',
      procurementRequests: [],
    })).toBe('approved')
  })

  it('keeps awaiting_parts when procurement exists', () => {
    expect(getPreviousRepairProgressStatus({
      status: 'in_repair',
      procurementRequests: [{ id: 'p1' }],
    })).toBe('awaiting_parts')
  })

  it('returns null at the first step', () => {
    expect(getPreviousRepairProgressStatus({ status: 'pending_verification' })).toBeNull()
  })

  it('builds a shortened order for direct_repair', () => {
    const order = repairProgressOrderFor({ status: 'assigned', repairPath: 'direct_repair' })
    expect(order).not.toContain('diagnosed')
    expect(order).not.toContain('awaiting_approval')
    expect(order).not.toContain('approved')
    expect(order).toContain('assigned')
    expect(order).toContain('in_repair')
  })
})
