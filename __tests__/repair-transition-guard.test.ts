import { describe, expect, it, vi } from 'vitest'
import { repairTransitionWriteError } from '@/lib/repair-transition-guard'

const noop = () => {}

describe('repairTransitionWriteError', () => {
  it('refuses a jump straight to collected, skipping QC and release', () => {
    const error = repairTransitionWriteError(
      { status: 'collected', ref: 'REP/2026/0190' },
      { status: 'received' },
      noop,
    )
    expect(error).toMatch(/cannot move this repair/i)
  })

  it('refuses ready without QC', () => {
    expect(repairTransitionWriteError({ status: 'ready' }, { status: 'assigned' }, noop)).toBeTruthy()
  })

  it('allows the legitimate qc → ready step', () => {
    expect(repairTransitionWriteError({ status: 'ready' }, { status: 'qc' }, noop)).toBeNull()
  })

  it('allows an unchanged status', () => {
    expect(repairTransitionWriteError({ status: 'in_repair' }, { status: 'in_repair' }, noop)).toBeNull()
  })

  it('allows a create, where there is no previous record', () => {
    expect(repairTransitionWriteError({ status: 'collected' }, undefined, noop)).toBeNull()
  })

  it('leaves unknown statuses alone rather than guessing', () => {
    expect(repairTransitionWriteError({ status: 'collected' }, { status: 'something_legacy' }, noop)).toBeNull()
    expect(repairTransitionWriteError({ status: 'brand_new_state' }, { status: 'received' }, noop)).toBeNull()
  })

  it('logs but permits an irregular move that is not a guarded target', () => {
    const log = vi.fn()
    expect(repairTransitionWriteError({ status: 'in_repair', ref: 'REP/1' }, { status: 'received' }, log)).toBeNull()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('allowed-but-irregular'))
  })
})
