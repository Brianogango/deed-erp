import { describe, expect, it } from 'vitest'
import { formatModuleLabel } from '@/lib/auth/access'

describe('global module labels', () => {
  it('shows the renamed labels for every role', () => {
    expect(formatModuleLabel('company_property')).toBe('Asset Management')
    expect(formatModuleLabel('inventory')).toBe('Inventory')
  })

  it('keeps stable internal module identifiers', () => {
    expect(formatModuleLabel('company_property')).not.toBe('Property')
    expect(formatModuleLabel('inventory')).not.toBe('Operations')
  })
})
