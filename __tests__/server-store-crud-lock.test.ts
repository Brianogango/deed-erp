import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetServerSession, mockLoadAppState, mockSaveStoreKeys, mockWithAppStateKeyLock } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockLoadAppState: vi.fn(),
  mockSaveStoreKeys: vi.fn(),
  mockWithAppStateKeyLock: vi.fn(async (_key: string, fn: () => Promise<any>) => fn()),
}))

vi.mock('@/lib/auth/server', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/server-store', () => ({
  loadAppState: mockLoadAppState,
  saveStoreKeys: mockSaveStoreKeys,
  withAppStateKeyLock: mockWithAppStateKeyLock,
}))

import { makeCreateHandler, makeDetailHandlers, makeListHandler } from '@/lib/server-store-crud'

const session = { user: { id: 'user-1', role: 'director' } }

beforeEach(() => {
  vi.clearAllMocks()
  mockWithAppStateKeyLock.mockImplementation(async (_key: string, fn: () => Promise<any>) => fn())
  mockGetServerSession.mockResolvedValue(session)
})

describe('makeDetailHandlers lockKey opt-in', () => {
  it('does not acquire a lock when lockKey is not configured', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [{ id: '1', name: 'a' }] })
    const { PATCH } = makeDetailHandlers<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: () => 'unused' as any,
    })
    const req = new NextRequest('http://localhost/api/widgets/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'b' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { id: '1' } })
    expect(res.status).toBe(200)
    expect(mockWithAppStateKeyLock).not.toHaveBeenCalled()
  })

  it('acquires the configured lock before reading/writing the collection', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [{ id: '1', name: 'a' }] })
    const { PATCH } = makeDetailHandlers<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: () => 'unused' as any,
      lockKey: 'deed_widgets',
    })
    const req = new NextRequest('http://localhost/api/widgets/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'b' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { id: '1' } })
    expect(res.status).toBe(200)
    expect(mockWithAppStateKeyLock).toHaveBeenCalledWith('deed_widgets', expect.any(Function))
    expect((await res.json()).item.name).toBe('b')
  })
})

describe('onWritten dual-write hook opt-in', () => {
  it('fires after a successful create, with the created item and event "create"', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [] })
    const onWritten = vi.fn().mockResolvedValue(undefined)
    const POST = makeCreateHandler<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: (body) => ({ id: 'new-1', name: body.name as string }),
      onWritten,
    })
    const req = new NextRequest('http://localhost/api/widgets', {
      method: 'POST',
      body: JSON.stringify({ name: 'a' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(onWritten).toHaveBeenCalledWith({ id: 'new-1', name: 'a' }, 'create')
  })

  it('fires after a successful patch, with event "patch"', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [{ id: '1', name: 'a' }] })
    const onWritten = vi.fn().mockResolvedValue(undefined)
    const { PATCH } = makeDetailHandlers<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: () => 'unused' as any,
      onWritten,
    })
    const req = new NextRequest('http://localhost/api/widgets/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'b' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { id: '1' } })
    expect(res.status).toBe(200)
    expect(onWritten).toHaveBeenCalledWith({ id: '1', name: 'b' }, 'patch')
  })

  it('resolves Next 15 promise params on PATCH', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [{ id: '1', name: 'a' }] })
    const { PATCH } = makeDetailHandlers<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: () => 'unused' as any,
    })
    const req = new NextRequest('http://localhost/api/widgets/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'b' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).item).toEqual({ id: '1', name: 'b' })
  })

  it('never fails the request when onWritten rejects', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [] })
    const onWritten = vi.fn().mockRejectedValue(new Error('mirror boom'))
    const POST = makeCreateHandler<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: (body) => ({ id: 'new-1', name: body.name as string }),
      onWritten,
    })
    const req = new NextRequest('http://localhost/api/widgets', {
      method: 'POST',
      body: JSON.stringify({ name: 'a' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it('does not fire when not configured', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [] })
    const POST = makeCreateHandler<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: (body) => ({ id: 'new-1', name: body.name as string }),
    })
    const req = new NextRequest('http://localhost/api/widgets', {
      method: 'POST',
      body: JSON.stringify({ name: 'a' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })
})

describe('makeListHandler Prisma scope', () => {
  it('loads only the requested collection key', async () => {
    mockLoadAppState.mockResolvedValue({ deed_widgets: [{ id: '1', name: 'a' }] })
    const GET = makeListHandler<{ id: string; name: string }>({
      storeKey: 'deed_widgets',
      build: () => 'unused' as any,
    })
    const res = await GET(new NextRequest('http://localhost/api/widgets'))
    expect(res.status).toBe(200)
    expect(mockLoadAppState).toHaveBeenCalledWith(['deed_widgets'])
    const body = await res.json()
    expect(body.items).toEqual([{ id: '1', name: 'a' }])
  })
})
