import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetSession, mockLoadAppState, mockVersions, mockSetVersion } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockVersions: vi.fn(),
  mockSetVersion: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  loadAppStateForWrite: mockLoadAppState,
  saveStoreKeys: vi.fn(),
  getAppStateVersion: mockSetVersion,
  getAppStateKeyVersions: mockVersions,
}))
vi.mock('@/lib/auth/db', () => ({ sql: vi.fn(), withDbTransaction: vi.fn() }))

import { GET } from '@/app/api/store/route'

const director = { user: { id: 'u1', role: 'director', modules: ['inventory', 'repair', 'sales'] } }
const get = (keys: string, have?: Record<string, string>) => GET(new NextRequest(`http://localhost/api/store?keys=${keys}`, {
  headers: have ? { 'x-store-have': JSON.stringify(have) } : {},
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(director)
  mockSetVersion.mockResolvedValue('v-set')
  mockVersions.mockResolvedValue({ deed_serials: '3@t1|', deed_products: '7@t2|' })
  mockLoadAppState.mockImplementation(async (keys: string[]) => Object.fromEntries(keys.map(k => [k, [{ id: `${k}-1` }]])))
})

describe('GET /api/store — per-collection versions', () => {
  it('sends versions and every collection to a browser that holds nothing', async () => {
    const body = await (await get('deed_serials,deed_products', {})).json()
    expect(body.deed_serials).toBeDefined()
    expect(body.deed_products).toBeDefined()
    expect(body.unchanged).toEqual([])
    expect(body.versions.deed_serials).toMatch(/^3@t1\|#/)
  })

  it('leaves out collections the browser already holds at the current version', async () => {
    const first = await (await get('deed_serials,deed_products', {})).json()
    const res = await get('deed_serials,deed_products', { deed_serials: first.versions.deed_serials, deed_products: 'old' })
    const body = await res.json()
    expect(body.unchanged).toEqual(['deed_serials'])
    expect(body.deed_serials).toBeUndefined()
    expect(body.deed_products).toBeDefined()
    expect(mockLoadAppState).toHaveBeenLastCalledWith(['deed_products'])
  })

  it('never lets the browser cache replay an answer for a different request', async () => {
    const res = await get('deed_serials', {})
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('a version from another user or role never counts as unchanged', async () => {
    const mine = await (await get('deed_serials', {})).json()
    mockGetSession.mockResolvedValue({ user: { id: 'u2', role: 'sales_rep', modules: ['sales'] } })
    const body = await (await get('deed_serials', { deed_serials: mine.versions.deed_serials })).json()
    expect(body.unchanged).toEqual([])
  })

  it('an unknown version is never unchanged', async () => {
    mockVersions.mockResolvedValue({ deed_serials: '' })
    const body = await (await get('deed_serials', { deed_serials: '' })).json()
    expect(body.unchanged).toEqual([])
  })
})
