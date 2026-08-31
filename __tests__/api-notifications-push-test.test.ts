import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { mockGetSession, mockPrisma, mockSendWebPush } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockPrisma: {
    notificationEndpoint: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  mockSendWebPush: vi.fn(),
}))

vi.mock('@/lib/auth/api', () => ({
  withApiErrorHandling: async (handler: () => Promise<any>) => {
    try {
      return await handler()
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 500
      const msg = status < 500 ? (err?.message ?? 'Bad request') : 'Internal server error'
      return new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
  getRequiredSession: mockGetSession,
}))

vi.mock('@/lib/prisma', () => ({ default: mockPrisma }))
vi.mock('@/lib/notifications/web-push', () => ({ sendWebPush: mockSendWebPush }))

import { POST } from '@/app/api/notifications/push-test/route'
import { defaultNotificationPolicy } from '@/lib/notifications/registry'

const USER_ID = '11111111-2222-3333-4444-555555555555'

describe('POST /api/notifications/push-test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: USER_ID, role: 'director' } })
    process.env.VAPID_PUBLIC_KEY = 'test-public'
    process.env.VAPID_PRIVATE_KEY = 'test-private'
  })

  it('503s when VAPID keys are missing', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    const res = await POST()
    expect(res.status).toBe(503)
  })

  it('400s when the user has no push subscription', async () => {
    mockPrisma.notificationEndpoint.findMany.mockResolvedValue([])
    const res = await POST()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not subscribed/i)
  })

  it('sends a test payload to each active endpoint', async () => {
    mockPrisma.notificationEndpoint.findMany.mockResolvedValue([
      { id: 'ep1', endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'p', authSecret: 's' },
    ])
    mockSendWebPush.mockResolvedValue({ success: true, provider: 'web_push' })
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(1)
    expect(mockSendWebPush).toHaveBeenCalledWith(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'p', authSecret: 's' },
      expect.objectContaining({ eventType: 'system.push_test' }),
    )
  })

  it('revokes gone endpoints', async () => {
    mockPrisma.notificationEndpoint.findMany.mockResolvedValue([
      { id: 'ep1', endpoint: 'https://fcm.googleapis.com/fcm/send/a', p256dh: 'p', authSecret: 's' },
    ])
    mockSendWebPush.mockResolvedValue({ success: false, provider: 'web_push', errorCode: '410', error: 'gone' })
    mockPrisma.notificationEndpoint.update.mockResolvedValue({})
    const res = await POST()
    expect(res.status).toBe(502)
    expect(mockPrisma.notificationEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ep1' } }),
    )
  })
})

describe('browser push service worker', () => {
  it('handles push and notificationclick on the live PWA worker', () => {
    const source = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')
    expect(source).toContain("addEventListener('push'")
    expect(source).toContain("addEventListener('notificationclick'")
    expect(source).toContain('showNotification')
  })

  it('keeps the legacy worker URL as an alias of /sw.js', () => {
    const source = readFileSync(join(process.cwd(), 'public/deed-notifications-sw.js'), 'utf8')
    expect(source).toContain("importScripts('/sw.js')")
  })

  it('registers system.push_test as a push-only event', () => {
    expect(defaultNotificationPolicy('system.push_test').channels).toEqual(['push'])
  })
})
