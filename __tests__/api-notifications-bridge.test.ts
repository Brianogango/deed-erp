import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockSession, mockFindMany, mockPublish } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockFindMany: vi.fn(),
  mockPublish: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/prisma', () => ({ default: { user: { findMany: mockFindMany } } }))
vi.mock('@/lib/notifications/service', () => ({ publishNotificationEvent: mockPublish }))
vi.mock('@/lib/notifications/worker', () => ({ runNotificationWorker: vi.fn().mockResolvedValue(undefined) }))

import { POST } from '@/app/api/notifications/bridge/route'

const staff = [
  { id: 'tech-1', role: 'technician', isActive: true },
  { id: 'lead-1', role: 'technical_lead', isActive: true },
  { id: 'inv-1', role: 'inventory_officer', isActive: true },
  { id: 'admin-1', role: 'admin_officer', isActive: true },
]
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/notifications/bridge', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'tech-1', role: 'technician' } })
  mockFindMany.mockImplementation(async ({ where }: any) =>
    where?.id?.in ? staff.filter(u => where.id.in.includes(u.id)) : staff)
})

describe('a notification addressed to roles', () => {
  it('reaches the role holders even when the sender\'s browser knows no one', async () => {
    // REGRESSION 30-Sep-2026: a technician cannot load the user list, so a
    // parts request resolved to no recipients in the browser and was dropped.
    await post({
      recipients: [],
      recipientRoles: ['technical_lead', 'inventory_officer', 'admin_officer'],
      type: 'repair',
      title: 'Parts requested for REP/0312',
      body: 'Screen needed',
      entityKey: 'repair:r1:procurement:req-1',
    })
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0][0].userIds.sort()).toEqual(['admin-1', 'inv-1', 'lead-1'])
  })

  it('never notifies the person who raised it', async () => {
    mockSession.mockResolvedValue({ user: { id: 'lead-1', role: 'technical_lead' } })
    await post({ recipients: [], recipientRoles: ['technical_lead', 'inventory_officer'], type: 'repair', title: 't', body: 'b' })
    expect(mockPublish.mock.calls[0][0].userIds).toEqual(['inv-1'])
  })

  it('still sends to explicit recipients as before', async () => {
    await post({ recipients: ['admin-1'], type: 'repair', title: 't', body: 'b' })
    expect(mockPublish.mock.calls[0][0].userIds).toEqual(['admin-1'])
  })

  it('sends nothing when there is nobody to tell', async () => {
    await post({ recipients: [], type: 'repair', title: 't', body: 'b' })
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
