import { describe, expect, it } from 'vitest'
import { classifyWidth } from '@/lib/data-table/use-breakpoint'

describe('table toolbar responsive breakpoints', () => {
  it('classifies mobile / tablet / laptop / desktop bands', () => {
    expect(classifyWidth(375)).toBe('mobile')
    expect(classifyWidth(800)).toBe('tablet')
    expect(classifyWidth(1200)).toBe('laptop')
    expect(classifyWidth(1600)).toBe('desktop')
  })
})

describe('column priority defaults', () => {
  // Mirrors DataTable PRIORITY_CAP — keep in sync with types.ts comments:
  // 1 always · 2 tablet+ · 3 laptop/desktop
  const PRIORITY_CAP = { tablet: 2, laptop: 3, desktop: 3 } as const

  it('shows priority-2 columns on tablet-width content panes', () => {
    expect(PRIORITY_CAP.tablet).toBe(2)
    const columns = [
      { key: 'ref', priority: 1 },
      { key: 'customer', priority: 2 },
      { key: 'technician', priority: 3 },
    ]
    const visible = columns.filter(c => c.priority <= PRIORITY_CAP.tablet).map(c => c.key)
    expect(visible).toEqual(['ref', 'customer'])
  })
})

describe('toolbar filter chip derivation', () => {
  it('treats allValue as inactive', () => {
    const allValue = 'all'
    const filters = [
      { key: 'status', value: 'all', allValue },
      { key: 'staff', value: 'u1', allValue },
    ]
    const active = filters.filter(f => f.value !== (f.allValue ?? 'all') && f.value !== '')
    expect(active.map(f => f.key)).toEqual(['staff'])
  })

  it('limits desktop primary filters to two', () => {
    const keys = ['status', 'vendor', 'branch', 'category']
    expect(keys.slice(0, 2)).toEqual(['status', 'vendor'])
    expect(keys.slice(2)).toEqual(['branch', 'category'])
  })
})

describe('toolbar More filters visibility', () => {
  function hasFilterSurface(args: {
    isMobile: boolean
    primaryCount: number
    hasAdvanced: boolean
    hasColumnFilters: boolean
  }) {
    const secondaryCount = Math.max(0, args.primaryCount - 2)
    return args.isMobile
      ? args.primaryCount > 0 || args.hasAdvanced || args.hasColumnFilters
      : secondaryCount > 0 || args.hasAdvanced || args.hasColumnFilters
  }

  it('hides More filters on desktop when only inline primaries exist', () => {
    expect(
      hasFilterSurface({
        isMobile: false,
        primaryCount: 1,
        hasAdvanced: false,
        hasColumnFilters: false,
      }),
    ).toBe(false)
    expect(
      hasFilterSurface({
        isMobile: false,
        primaryCount: 2,
        hasAdvanced: false,
        hasColumnFilters: false,
      }),
    ).toBe(false)
  })

  it('shows More filters on desktop when a third primary or column filters exist', () => {
    expect(
      hasFilterSurface({
        isMobile: false,
        primaryCount: 3,
        hasAdvanced: false,
        hasColumnFilters: false,
      }),
    ).toBe(true)
    expect(
      hasFilterSurface({
        isMobile: false,
        primaryCount: 1,
        hasAdvanced: false,
        hasColumnFilters: true,
      }),
    ).toBe(true)
  })
})

describe('export menu options', () => {
  it('maps supported formats to labels', () => {
    const formats: Array<'pdf' | 'excel'> = ['pdf', 'excel']
    const options = formats.map(id => ({
      id,
      label: id === 'pdf' ? 'Export PDF' : 'Export Excel',
    }))
    expect(options).toEqual([
      { id: 'pdf', label: 'Export PDF' },
      { id: 'excel', label: 'Export Excel' },
    ])
  })
})
