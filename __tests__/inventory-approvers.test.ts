import { describe, expect, it } from 'vitest'
import { canApproveInventory } from '@/lib/inventory/permissions'

describe('who approves stock adjustments', () => {
  it('director, admin officer, inventory officer and technical lead', () => {
    for (const role of ['director', 'admin_officer', 'inventory_officer', 'technical_lead']) expect(canApproveInventory(role)).toBe(true)
  })
  it('nobody else', () => {
    for (const role of ['finance_officer', 'sales_rep', 'technician', 'kilimall_officer', '', undefined]) expect(canApproveInventory(role)).toBe(false)
  })
})
