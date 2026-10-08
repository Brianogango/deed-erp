import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    opportunityActivity: { findMany: vi.fn() },
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))

import { appendInventoryAuditLog } from '@/lib/inventory/audit'
import { activityExtras, loadScreenActivities } from '@/lib/opportunity-activity-read-model.server'

const USER = '0b1c6f8e-1d2a-4c3b-9e8f-112233445566'

beforeEach(() => vi.clearAllMocks())

describe('audit log entries go to audit_logs', () => {
  it('writes one row per entry', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: USER })
    await appendInventoryAuditLog({ action: 'serial_edit', documentRef: 'SN-1', details: 'moved', userId: USER, username: 'ann' })
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: { userId: USER, action: 'serial_edit', entityType: 'document', entityKey: 'SN-1', newValues: { details: 'moved', username: 'ann' } },
    })
  })

  it('drops a user id that is not a real user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    await appendInventoryAuditLog({ action: 'x', documentRef: 'D', details: '', userId: USER })
    expect(mockPrisma.auditLog.create.mock.calls[0][0].data.userId).toBeNull()
  })
})

describe('opportunity activities read from their table', () => {
  it('adds subject, status and outcome from screen_extras', async () => {
    mockPrisma.opportunityActivity.findMany.mockResolvedValue([{
      id: 'a-1', opportunityId: 'o-1', type: 'call', description: 'd', scheduledAt: null, createdById: USER,
      createdAt: new Date('2026-10-01'), screenExtras: { subject: 'Follow up', status: 'completed', outcome: 'Won' },
    }])
    const [a] = await loadScreenActivities([{ id: 'local-1', subject: 'only in copy' }])
    expect(a).toMatchObject({ id: 'a-1', subject: 'Follow up', status: 'completed', outcome: 'Won' })
  })

  it('completing keeps the subject and adds the outcome', () => {
    expect(activityExtras({ status: 'completed', outcome: 'Won', id: 'x' }, { subject: 'Follow up' }))
      .toEqual({ subject: 'Follow up', status: 'completed', outcome: 'Won' })
  })
})
