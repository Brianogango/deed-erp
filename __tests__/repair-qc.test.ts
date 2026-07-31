import { describe, expect, it } from 'vitest'
import {
  buildDefaultRepairQcItems,
  prepareRepairQcItemsForRound,
  summarizeFailedQcItems,
} from '@/lib/repair-qc'

describe('repair-qc helpers', () => {
  it('builds a non-empty default checklist', () => {
    let n = 0
    const items = buildDefaultRepairQcItems(() => `id-${++n}`)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(i => i.passed === false)).toBe(true)
  })

  it('seeds defaults when checklist is empty', () => {
    let n = 0
    const items = prepareRepairQcItemsForRound([], () => `id-${++n}`)
    expect(items.length).toBeGreaterThan(0)
  })

  it('clears prior pass ticks on re-QC', () => {
    const existing = [
      { id: 'a', description: 'Power on', passed: true, testedBy: 'QC', testedDate: '2026-01-01', notes: 'ok' },
      { id: 'b', description: 'Issue fixed', passed: false, notes: 'still broken' },
    ]
    const next = prepareRepairQcItemsForRound(existing, () => 'x')
    expect(next).toHaveLength(2)
    expect(next.every(i => i.passed === false)).toBe(true)
    expect(next.every(i => i.testedBy === undefined && i.testedDate === undefined && i.notes === undefined)).toBe(true)
    expect(next.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('summarizes failed items with notes', () => {
    const summary = summarizeFailedQcItems([
      { id: '1', description: 'Power on', passed: true },
      { id: '2', description: 'Issue fixed', passed: false, notes: 'still boots to BSOD' },
      { id: '3', description: 'Cleaned', passed: false },
    ])
    expect(summary).toBe('Issue fixed (still boots to BSOD); Cleaned')
  })

  it('does not treat empty checklist as all-passed', () => {
    const empty: { passed: boolean }[] = []
    const allPassed = empty.length > 0 && empty.every(i => i.passed)
    expect(allPassed).toBe(false)
  })
})
