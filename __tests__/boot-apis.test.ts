import { describe, it, expect } from 'vitest'
import { bootApiGroupsForRoute, remainingBootApiGroups } from '@/lib/boot-apis'

describe('bootApiGroupsForRoute', () => {
  it('does not boot HR or settings lists on unrelated routes', () => {
    const groups = bootApiGroupsForRoute('/documents')
    expect(groups).toEqual([])
    expect(bootApiGroupsForRoute('/pos')).not.toContain('employees')
    expect(bootApiGroupsForRoute('/pos')).not.toContain('leave')
    expect(bootApiGroupsForRoute('/pos')).not.toContain('approval_rules')
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
    expect(groups).toEqual(expect.arrayContaining(['payroll']))
    expect(groups).not.toContain('employees')
    expect(groups).not.toContain('leave')
    expect(groups).not.toContain('products')
    expect(groups).not.toContain('contacts')
    expect(groups).not.toContain('sales')
  })

  it('does not duplicate dashboard collections already supplied by store hydration', () => {
    const groups = bootApiGroupsForRoute('/')
    expect(groups).toEqual([])
    expect(groups).not.toContain('products')
    expect(groups).not.toContain('sales')
  })

  it('does not walk every repairs page during repair workspace boot', () => {
    const groups = bootApiGroupsForRoute('/repairs')
    expect(groups).toEqual(expect.arrayContaining(['products', 'contacts']))
    expect(groups).not.toContain('repairs')
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
