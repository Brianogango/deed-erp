import { describe, expect, it } from 'vitest'

/** Mirrors TabBar visible/overflow selection in components/ui/index.tsx */
function resolveOverflowTabs<T extends { id: string }>(
  tabs: T[],
  active: string,
  maxVisible: number,
) {
  if (tabs.length <= maxVisible) return { visibleTabs: tabs, overflowTabs: [] as T[] }
  const activeTab = tabs.find(t => t.id === active)
  let base = tabs.slice(0, maxVisible)
  if (activeTab && !base.some(t => t.id === activeTab.id)) {
    base = maxVisible === 1 ? [activeTab] : [...base.slice(0, maxVisible - 1), activeTab]
  }
  const seen = new Set<string>()
  const visibleTabs = base.filter(t => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
  const overflowTabs = tabs.filter(t => !visibleTabs.some(v => v.id === t.id))
  return { visibleTabs, overflowTabs }
}

describe('TabBar overflow', () => {
  const accounting = [
    'invoices', 'bills', 'refunds', 'journals', 'reports', 'cashbook',
    'coa', 'gl', 'partner_ledger', 'migration',
  ].map(id => ({ id }))

  it('keeps every tab reachable via visible ∪ More', () => {
    for (const active of accounting) {
      const { visibleTabs, overflowTabs } = resolveOverflowTabs(accounting, active.id, 6)
      const reachable = new Set([...visibleTabs, ...overflowTabs].map(t => t.id))
      expect(reachable.size).toBe(accounting.length)
      expect(visibleTabs.some(t => t.id === active.id)).toBe(true)
    }
  })

  it('does not create a More menu when tabs fit', () => {
    const tabs = accounting.slice(0, 4)
    const { overflowTabs } = resolveOverflowTabs(tabs, 'invoices', 6)
    expect(overflowTabs).toHaveLength(0)
  })

  it('pulls an overflow active tab into the visible row', () => {
    const { visibleTabs, overflowTabs } = resolveOverflowTabs(accounting, 'migration', 6)
    expect(visibleTabs.map(t => t.id)).toContain('migration')
    expect(overflowTabs.map(t => t.id)).not.toContain('migration')
    expect(overflowTabs.length).toBeGreaterThan(0)
  })
})
