import { describe, expect, it, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockGetLatestAppStateUpdatedAt,
  mockLoadChangedStoreKeysSince,
  mockGetStoreNotifyLive,
  mockSubscribe,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetLatestAppStateUpdatedAt: vi.fn(),
  mockLoadChangedStoreKeysSince: vi.fn(),
  mockGetStoreNotifyLive: vi.fn(),
  mockSubscribe: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: mockGetSession,
}))

vi.mock('@/lib/server-store', () => ({
  getLatestAppStateUpdatedAt: mockGetLatestAppStateUpdatedAt,
  loadChangedStoreKeysSince: mockLoadChangedStoreKeysSince,
}))

vi.mock('@/lib/store-notify', () => ({
  getStoreNotifyLive: mockGetStoreNotifyLive,
  subscribeAppStateChanges: mockSubscribe,
}))

import { GET } from '@/app/api/store/stream/route'

const director = {
  user: {
    id: 'u1',
    name: 'Director',
    username: 'director',
    role: 'director',
    modules: ['repair', 'accounting', 'sales'],
  },
}

async function readSseUntil(res: Response, predicate: (text: string) => boolean, abort: AbortController) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (let i = 0; i < 40; i++) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (predicate(text)) return text
    }
    return text
  } finally {
    abort.abort()
    try { await reader.cancel() } catch { /* already closed */ }
  }
}

describe('GET /api/store/stream', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/store/stream'))
    expect(res.status).toBe(401)
  })

  it('announces changed key names without reconstructing collection payloads', async () => {
    mockGetSession.mockResolvedValue(director)
    mockGetStoreNotifyLive.mockResolvedValue(false)
    mockSubscribe.mockReturnValue(() => {})
    mockGetLatestAppStateUpdatedAt.mockResolvedValue('2026-09-15T12:00:00.000Z')
    mockLoadChangedStoreKeysSince.mockResolvedValue({
      keys: ['deed_expenses', 'deed_invoices'],
      latestUpdatedAt: '2026-09-15T12:00:01.000Z',
    })

    const abort = new AbortController()
    const res = await GET(new NextRequest('http://localhost/api/store/stream', { signal: abort.signal }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('x-accel-buffering')).toBe('no')

    const text = await readSseUntil(
      res,
      chunk => chunk.includes('event: hello') && chunk.includes('event: store'),
      abort,
    )

    expect(text).toContain('event: hello')
    expect(text).toContain('"liveNotify":false')
    expect(text).toContain('event: store')
    expect(text).toContain('"state":{}')
    expect(text).toContain('"patch":true')
    expect(text).toContain('"invalidated":["deed_expenses","deed_invoices"]')
    expect(text.includes('"blob"')).toBe(false)
    expect(mockLoadChangedStoreKeysSince).toHaveBeenCalled()
  })

  it('asks Prisma only for the route keys the client is watching', async () => {
    mockGetSession.mockResolvedValue(director)
    mockGetStoreNotifyLive.mockResolvedValue(false)
    mockSubscribe.mockReturnValue(() => {})
    mockGetLatestAppStateUpdatedAt.mockResolvedValue('2026-09-15T12:00:00.000Z')
    mockLoadChangedStoreKeysSince.mockResolvedValue({
      keys: ['deed_expenses'],
      latestUpdatedAt: '2026-09-15T12:00:01.000Z',
    })

    const abort = new AbortController()
    const res = await GET(new NextRequest(
      'http://localhost/api/store/stream?keys=deed_expenses,deed_auditLogs',
      { signal: abort.signal },
    ))
    expect(res.status).toBe(200)

    const text = await readSseUntil(
      res,
      chunk => chunk.includes('event: store'),
      abort,
    )

    expect(mockLoadChangedStoreKeysSince.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['deed_expenses', 'deed_auditLogs']),
    )
    expect(text).toContain('"invalidated":["deed_expenses"]')
    expect(text).not.toContain('deed_auditLogs')
  })
})
