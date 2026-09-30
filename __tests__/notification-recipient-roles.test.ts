import { describe, expect, it } from 'vitest'
import { resolveRoleRecipients } from '@/lib/notifications/recipient-roles'

const users = [
  { id: 'lead', role: 'technical_lead', isActive: true },
  { id: 'inv', role: 'inventory', isActive: true },
  { id: 'admin', role: 'admin_officer', isActive: true },
  { id: 'gone', role: 'inventory_officer', isActive: false },
  { id: 'tech', role: 'technician', isActive: true },
]

describe('who a role-addressed notification reaches', () => {
  it('finds every active user holding one of the roles', () => {
    expect(resolveRoleRecipients(users, ['technical_lead', 'inventory_officer', 'admin_officer']))
      .toEqual(['lead', 'inv', 'admin'])
  })

  it('treats a legacy role name as the role it stands for', () => {
    // "inventory" is stored for older accounts; it is an inventory officer.
    expect(resolveRoleRecipients(users, ['inventory_officer'])).toEqual(['inv'])
  })

  it('leaves out deactivated users and the person who acted', () => {
    expect(resolveRoleRecipients(users, ['technical_lead', 'inventory_officer'], { excludeUserId: 'lead' })).toEqual(['inv'])
  })

  it('returns nobody when no roles are given', () => {
    expect(resolveRoleRecipients(users, undefined)).toEqual([])
  })
})
