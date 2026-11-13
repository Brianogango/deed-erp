import { describe, expect, it } from 'vitest'
import { userCan } from '@/lib/auth/can'

const can = (role: string | undefined) => userCan({ role: role as never, modules: [] }, 'manageInventoryApprovals')

describe('who approves stock adjustments', () => {
  it('director, admin officer, inventory officer and technical lead', () => {
    for (const role of ['director', 'admin_officer', 'inventory_officer', 'technical_lead', 'admin', 'lead_tech']) expect(can(role)).toBe(true)
  })
  it('nobody else', () => {
    for (const role of ['finance_officer', 'sales_rep', 'technician', 'kilimall_officer', '', undefined]) expect(can(role)).toBe(false)
  })
  it('a custom role needs the permission in its list', () => {
    expect(userCan({ role: 'inventory_officer', modules: [], permissions: ['inventory.adjustments'] } as never, 'manageInventoryApprovals')).toBe(false)
    expect(userCan({ role: 'inventory_officer', modules: [], permissions: ['manageInventoryApprovals'] } as never, 'manageInventoryApprovals')).toBe(true)
  })
})
