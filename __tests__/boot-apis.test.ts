import { describe, it, expect } from 'vitest'
import { bootApiGroupsForRoute, remainingBootApiGroups } from '@/lib/boot-apis'

describe('bootApiGroupsForRoute', () => {
  it('always includes shell essentials', () => {
    const groups = bootApiGroupsForRoute('/documents')
    expect(groups).toEqual(expect.arrayContaining(['employees', 'leave', 'approval_rules']))
  })

  it('scopes purchases to catalog + contacts + purchase orders', () => {
    const groups = bootApiGroupsForRoute('/purchases')
    expect(groups).toEqual(expect.arrayContaining(['products', 'contacts', 'purchases']))
  })

  it('matches nested finance invoice routes by prefix', () => {
    const groups = bootApiGroupsForRoute('/finance/invoices/abc')
    expect(groups).toEqual(expect.arrayContaining(['contacts', 'sales']))
  })

  it('does not boot the catalog on Finance first paint', () => {
    const groups = bootApiGroupsForRoute('/finance')
    expect(groups).toEqual(expect.arrayContaining(['payroll', 'employees', 'leave']))
    expect(groups).not.toContain('products')
    expect(groups).not.toContain('contacts')
    expect(groups).not.toContain('sales')
  })

  it('lists idle groups as the remainder', () => {
    const immediate = bootApiGroupsForRoute('/inventory')
    const rest = remainingBootApiGroups(immediate)
    expect(rest).toContain('crm')
    expect(rest).not.toContain('products')
    expect(rest).not.toContain('stock_moves')
  })

  it('keeps the operations alias on the same boot groups as inventory', () => {
    expect(bootApiGroupsForRoute('/operations')).toEqual(bootApiGroupsForRoute('/inventory'))
  })
})
