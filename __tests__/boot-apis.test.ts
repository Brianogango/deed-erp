import { describe, it, expect } from 'vitest'
import { bootApiGroupsForRoute, remainingBootApiGroups } from '@/lib/boot-apis'

describe('bootApiGroupsForRoute', () => {
  it('always includes shell essentials', () => {
    const groups = bootApiGroupsForRoute('/documents')
    expect(groups).toEqual(expect.arrayContaining(['employees', 'leave', 'approval_rules']))
  })

  it('scopes sales to contacts + sales + crm + products', () => {
    const groups = bootApiGroupsForRoute('/sales')
    expect(groups).toEqual(expect.arrayContaining(['products', 'contacts', 'sales', 'crm']))
    expect(groups).not.toContain('stock_moves')
    expect(groups).not.toContain('repairs')
  })

  it('matches nested finance invoice routes by prefix', () => {
    const groups = bootApiGroupsForRoute('/finance/invoices/abc')
    expect(groups).toEqual(expect.arrayContaining(['contacts', 'sales']))
  })

  it('lists idle groups as the remainder', () => {
    const immediate = bootApiGroupsForRoute('/operations')
    const rest = remainingBootApiGroups(immediate)
    expect(rest).toContain('crm')
    expect(rest).not.toContain('products')
    expect(rest).not.toContain('stock_moves')
  })
})
