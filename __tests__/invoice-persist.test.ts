import { afterEach, describe, expect, it, vi } from 'vitest'
import { lockVersionMismatch, readExpectedVersion, readLockVersionFromResponse } from '@/lib/optimistic-lock'
import {
  invoicePersistBody,
  invoiceErrorMessage,
  isInvoiceLockConflict,
  putInvoiceOrCreateThenPost,
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

describe('putInvoiceOrCreateThenPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces the create error instead of the original Not found toast', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 404,
        ok: false,
        json: async () => ({ error: 'Not found' }),
      })
      .mockResolvedValueOnce({
        status: 400,
        ok: false,
        json: async () => ({ error: '3-way match failed: quantity 2 exceeds received/unbilled 0' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { res, data } = await putInvoiceOrCreateThenPost('bill-blob', {
      id: 'bill-blob',
      status: 'posted',
      type: 'vendor_bill',
    })

    expect(res.status).toBe(400)
    expect(invoiceErrorMessage(data, 'Could not post invoice to accounting')).toBe(
      '3-way match failed: quantity 2 exceeds received/unbilled 0',
    )
    expect(fetchMock.mock.calls[1][0]).toBe('/api/invoices')
  })

  it('posts using the Prisma id when create assigns a new UUID', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 404,
        ok: false,
        json: async () => ({ error: 'Not found' }),
      })
      .mockResolvedValueOnce({
        status: 201,
        ok: true,
        json: async () => ({ id: 'prisma-bill' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ id: 'prisma-bill', lockVersion: 1, status: 'approved' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await putInvoiceOrCreateThenPost('bill-blob', {
      id: 'bill-blob',
      status: 'posted',
      type: 'vendor_bill',
    })

    expect(result.id).toBe('prisma-bill')
    expect(result.res.status).toBe(200)
    expect(fetchMock.mock.calls[2][0]).toBe('/api/invoices/prisma-bill')
  })
})
