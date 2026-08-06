import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

const { mockGetSession, mockLoadAppState, mockSaveStoreKeys, mockGetAppStateVersion } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockGetAppStateVersion: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  getServerSession: mockGetSession,
}))

vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  getAppStateVersion: mockGetAppStateVersion,
}))

import { POST as STORE_POST, GET as STORE_GET } from '@/app/api/store/route'

const financeSession = {
  user: {
    id: 'u3',
    name: 'Finance Officer',
    username: 'finance',
    role: 'finance_officer',
    modules: ['accounting', 'sales', 'contacts', 'inventory'],
  },
}

const CURRENT_VERSION = '2026-08-06T10:00:00.000Z:2'

function expectedEtag(keys: string[], version: string): string {
  const session = financeSession
  return `W/"${crypto.createHash('md5')
    .update(`${session.user.id}:${session.user.role}:${[...session.user.modules].sort().join(',')}:${keys.join(',')}:${version}`)
    .digest('hex')}"`
}

function postReq(body: unknown, headers?: Record<string, string>): Request {
  return new Request('http://localhost/api/store', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(financeSession)
  mockLoadAppState.mockResolvedValue({})
  mockSaveStoreKeys.mockResolvedValue(undefined)
  mockGetAppStateVersion.mockResolvedValue(CURRENT_VERSION)
})

describe('P1-SEC-005 — POST /api/store optimistic concurrency', () => {
  it('behaves as today when no If-Match / _version is supplied (backward compatible)', async () => {
    const res = await STORE_POST(postReq({ deed_quotes: '[]' }))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.version).toBe(CURRENT_VERSION)
    expect(res.headers.get('etag')).toBe(expectedEtag(['deed_quotes'], CURRENT_VERSION))
  })

  it('returns 409 conflict when If-Match header does not match current version', async () => {
    const res = await STORE_POST(postReq(
      { deed_quotes: '[{"id":"q1"}]' },
      { 'If-Match': 'stale-version:0' },
    ))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ error: 'conflict', currentVersion: CURRENT_VERSION })
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('returns 409 when body._version is stale', async () => {
    const res = await STORE_POST(postReq({
      deed_quotes: '[]',
      _version: 'old:1',
    }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', currentVersion: CURRENT_VERSION })
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('returns 409 when body If-Match is stale', async () => {
    const res = await STORE_POST(postReq({
      deed_quotes: '[]',
      'If-Match': 'old:1',
    }))
    expect(res.status).toBe(409)
    expect(mockSaveStoreKeys).not.toHaveBeenCalled()
  })

  it('saves when If-Match matches the current raw version', async () => {
    const res = await STORE_POST(postReq(
      { deed_quotes: '[]' },
      { 'If-Match': CURRENT_VERSION },
    ))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
    const body = await res.json()
    expect(body.version).toBe(CURRENT_VERSION)
  })

  it('saves when If-Match matches the weak ETag from GET', async () => {
    const etag = expectedEtag(['deed_quotes'], CURRENT_VERSION)
    const res = await STORE_POST(postReq(
      { deed_quotes: '[]' },
      { 'If-Match': etag },
    ))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })

  it('prefers the If-Match header over body._version', async () => {
    const res = await STORE_POST(postReq(
      { deed_quotes: '[]', _version: 'stale:0' },
      { 'If-Match': CURRENT_VERSION },
    ))
    expect(res.status).toBe(200)
    expect(mockSaveStoreKeys).toHaveBeenCalled()
  })
})

describe('P1-SEC-005 — GET /api/store version exposure', () => {
  it('includes ETag header and body.version for keyed reads', async () => {
    mockLoadAppState.mockResolvedValue({ deed_quotes: [{ id: 'q1' }] })
    const res = await STORE_GET(new NextRequest('http://localhost/api/store?keys=deed_quotes'))
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe(expectedEtag(['deed_quotes'], CURRENT_VERSION))
    const body = await res.json()
    expect(body.version).toBe(CURRENT_VERSION)
    expect(body.deed_quotes).toEqual([{ id: 'q1' }])
  })
})
