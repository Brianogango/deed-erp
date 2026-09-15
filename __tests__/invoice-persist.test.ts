import { afterEach, describe, expect, it, vi } from 'vitest'
import { lockVersionMismatch, readExpectedVersion, readLockVersionFromResponse } from '@/lib/optimistic-lock'
import {
  invoicePersistBody,
  isInvoiceLockConflict,
  putInvoiceWithLockRetry,
} from '@/lib/invoice-persist'

describe('invoicePersistBody', () => {
  it('omits lockVersion and expectedVersion so edit-then-confirm cannot 409', () => {
    const body = invoicePersistBody({
      id: 'inv-1',
      status: 'posted',
      lockVersion: 0,
      expectedVersion: 0,
      lines: [{ description: 'iPhone', qty: 1 }],
    })
    expect(body).toEqual({
      id: 'inv-1',
      status: 'posted',
      lines: [{ description: 'iPhone', qty: 1 }],
    })
    expect('lockVersion' in body).toBe(false)
    expect('expectedVersion' in body).toBe(false)
    expect(lockVersionMismatch(2, readExpectedVersion(body as Record<string, unknown>))).toBe(false)
  })
})

describe('isInvoiceLockConflict', () => {
  it('matches the Confirm toast copy', () => {
    expect(isInvoiceLockConflict(409, { error: 'Record was modified by another user' })).toBe(true)
    expect(isInvoiceLockConflict(409, { error: 'Posted invoices are immutable' })).toBe(false)
    expect(isInvoiceLockConflict(200, { error: 'Record was modified by another user' })).toBe(false)
  })
})

describe('putInvoiceWithLockRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PUTs without lockVersion on the first attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ id: 'inv-1', lockVersion: 3, status: 'approved' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { res, data } = await putInvoiceWithLockRetry('inv-1', {
      id: 'inv-1',
      status: 'posted',
      lockVersion: 0,
    })

    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ id: 'inv-1', status: 'posted' })
    expect(readLockVersionFromResponse(data)).toBe(3)
  })

  it('retries with the 409 lockVersion after a stale-client conflict', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 409,
        ok: false,
        json: async () => ({ error: 'Record was modified by another user', lockVersion: 2 }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ id: 'inv-1', lockVersion: 3, status: 'approved' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { res } = await putInvoiceWithLockRetry('inv-1', { status: 'posted', lockVersion: 0 })

    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('lockVersion')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).lockVersion).toBe(2)
  })

  it('retries without lockVersion when the 409 body has none (updateMany race)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 409,
        ok: false,
        json: async () => ({ error: 'Record was modified by another user' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ id: 'inv-1', lockVersion: 4, status: 'approved' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { res } = await putInvoiceWithLockRetry('inv-1', { status: 'posted', lockVersion: 1 })

    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('lockVersion')
  })
})
