import { describe, expect, it } from 'vitest'
import { mobileTabModules, mobileTabsHiddenFor } from '@/lib/navigation/mobile-tabs'

describe('phone tab bar modules', () => {
  it("gives each role its usual pair", () => {
    expect(mobileTabModules({ role: 'director', modules: [] })).toEqual(['sales', 'accounting'])
    expect(mobileTabModules({ role: 'sales_rep', modules: ['sales', 'crm', 'contacts'] })).toEqual(['sales', 'crm'])
    expect(mobileTabModules({ role: 'finance_officer', modules: ['accounting'] })).toEqual(['accounting', 'expenses'])
  })

  it('lets pinned modules win', () => {
    expect(mobileTabModules({ role: 'sales_rep', modules: ['sales', 'crm', 'contacts'] }, ['contacts'])).toEqual(['contacts', 'sales'])
  })

  it('never offers a module the person cannot open, and fills the gap', () => {
    expect(mobileTabModules({ role: 'technician', modules: ['repair', 'refurbishment'] })).toEqual(['repair', 'refurbishment'])
    expect(mobileTabModules({ role: 'admin_officer', modules: ['sales', 'delivery'] })).toEqual(['sales', 'delivery'])
    expect(mobileTabModules({ role: 'sales_rep', modules: ['sales'] }, ['accounting'])).toEqual(['sales', 'hr'])
  })

  it('ignores pins that are not modules', () => {
    expect(mobileTabModules({ role: 'director', modules: [] }, ['settings', 'my_work'])).toEqual(['sales', 'accounting'])
  })
})

describe('where the tab bar steps aside', () => {
  const q = (s: string) => new URLSearchParams(s)
  it('hides only on the till', () => {
    expect(mobileTabsHiddenFor('/pos', q(''))).toBe(true)
  })
  it('stays on open records and forms', () => {
    expect(mobileTabsHiddenFor('/sales', q('id=so-1'))).toBe(false)
    expect(mobileTabsHiddenFor('/finance/invoices/abc', q(''))).toBe(false)
    expect(mobileTabsHiddenFor('/sales', q('view=new'))).toBe(false)
  })
  it('shows on lists and dashboards', () => {
    expect(mobileTabsHiddenFor('/sales', q('tab=list'))).toBe(false)
    expect(mobileTabsHiddenFor('/', q(''))).toBe(false)
    expect(mobileTabsHiddenFor('/repairs', null)).toBe(false)
  })
})
