import { describe, expect, it, vi } from 'vitest'
import { observeRepairTransitions, repairTransitionWriteError } from '@/lib/repair-transition-guard'

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

describe('observeRepairTransitions — the path the traffic actually takes', () => {
  const row = (id: string, status: string, ref = `REP/${id}`) => ({ id, ref, status })

  it('reports a transition the state machine would refuse, without refusing it', () => {
    // This is the whole point: every status change other than assignment and
    // diagnosis arrives through POST /api/store, which never consulted the
    // guard. Refusing here on day one would block real work on no evidence.
    const lines: string[] = []
    const result = observeRepairTransitions(
      [row('r1', 'received')],
      [row('r1', 'collected')],
      m => lines.push(m),
    )
    expect(result).toMatchObject({ checked: 1, wouldRefuse: 1, irregular: 0 })
    expect(lines[0]).toContain('would-refuse')
    expect(lines[0]).toContain('REP/r1')
    expect(lines[0]).toContain('received → collected')
  })

  it('separates an irregular move from one that would be refused', () => {
    const lines: string[] = []
    const result = observeRepairTransitions(
      [row('r1', 'received'), row('r2', 'received')],
      [row('r1', 'collected'), row('r2', 'in_repair')],
      m => lines.push(m),
    )
    expect(result.wouldRefuse).toBe(1)
    expect(result.irregular).toBe(1)
    expect(lines.some(l => l.includes('irregular'))).toBe(true)
  })

  it('says nothing about a legitimate step', () => {
    const lines: string[] = []
    const result = observeRepairTransitions([row('r1', 'qc')], [row('r1', 'ready')], m => lines.push(m))
    expect(result).toMatchObject({ checked: 1, wouldRefuse: 0, irregular: 0 })
    expect(lines).toHaveLength(0)
  })

  it('ignores a repair the server has not seen, since a create has no previous status', () => {
    const lines: string[] = []
    const result = observeRepairTransitions([], [row('new', 'collected')], m => lines.push(m))
    expect(result.checked).toBe(0)
    expect(lines).toHaveLength(0)
  })

  it('ignores an unchanged status and an unknown one', () => {
    const lines: string[] = []
    observeRepairTransitions(
      [row('r1', 'in_repair'), row('r2', 'some_legacy_status')],
      [row('r1', 'in_repair'), row('r2', 'collected')],
      m => lines.push(m),
    )
    expect(lines).toHaveLength(0)
  })

  it('caps how much one write can log, but still counts everything', () => {
    const many = Array.from({ length: 30 }, (_, i) => `r${i}`)
    const lines: string[] = []
    const result = observeRepairTransitions(
      many.map(id => row(id, 'received')),
      many.map(id => row(id, 'collected')),
      m => lines.push(m),
    )
    expect(result.wouldRefuse).toBe(30)
    expect(lines.length).toBeLessThan(30)
    expect(lines[lines.length - 1]).toContain('not logged')
  })

  it('survives input that is not an array', () => {
    expect(observeRepairTransitions(null, undefined, noop)).toMatchObject({ checked: 0 })
  })
})
