import { describe, it, expect, vi } from 'vitest'
import {
  parsePaginationParams,
  paginateArray,
  paginatedResponse,
  parseCollectionPayload,
  canonicalizeCollectionPath,
  fetchCollection,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '@/lib/api-pagination'

describe('parsePaginationParams()', () => {
  it('defaults to page 1 and limit 50', () => {
    const p = parsePaginationParams(new URLSearchParams())
    expect(p).toMatchObject({ page: 1, limit: PAGINATION_DEFAULT_LIMIT, skip: 0, order: 'desc' })
  })

  it('caps limit at 200', () => {
    const p = parsePaginationParams(new URLSearchParams('limit=999'))
    expect(p.limit).toBe(PAGINATION_MAX_LIMIT)
    expect(p.skip).toBe(0)
  })

  it('computes skip from page and limit', () => {
    const p = parsePaginationParams(new URLSearchParams('page=3&limit=25'))
    expect(p).toMatchObject({ page: 3, limit: 25, skip: 50 })
  })

  it('accepts sort/order when sort is allowed', () => {
    const p = parsePaginationParams(new URLSearchParams('sort=createdAt&order=asc'), {
      allowedSorts: ['createdAt', 'invoiceDate'],
      defaultSort: 'invoiceDate',
    })
    expect(p.sort).toBe('createdAt')
    expect(p.order).toBe('asc')
  })

  it('falls back to defaultSort when sort is not allowed', () => {
    const p = parsePaginationParams(new URLSearchParams('sort=hacked'), {
      allowedSorts: ['createdAt'],
      defaultSort: 'createdAt',
    })
    expect(p.sort).toBe('createdAt')
  })
})

describe('paginateArray()', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }))

  it('returns the correct page of results', () => {
    const page2 = paginateArray(rows, 2, 50)
    expect(page2.items).toHaveLength(50)
    expect(page2.items[0].id).toBe(51)
    expect(page2.items[49].id).toBe(100)
    expect(page2.total).toBe(120)
    expect(page2.totalPages).toBe(3)
  })

  it('reports accurate total and totalPages', () => {
    const page = paginateArray(rows, 1, 50)
    expect(page.total).toBe(120)
    expect(page.totalPages).toBe(3)
    expect(paginatedResponse([], 0, 1, 50).totalPages).toBe(0)
  })
})

describe('parseCollectionPayload()', () => {
  it('wraps a raw array as a single page', () => {
    const parsed = parseCollectionPayload([{ id: 1 }, { id: 2 }])
    expect(parsed.items).toHaveLength(2)
    expect(parsed.total).toBe(2)
    expect(parsed.totalPages).toBe(1)
  })

  it('reads a paginated envelope', () => {
    const parsed = parseCollectionPayload({
      items: [{ id: 'a' }],
      total: 401,
      page: 2,
      limit: 200,
    })
    expect(parsed.items).toEqual([{ id: 'a' }])
    expect(parsed.total).toBe(401)
    expect(parsed.page).toBe(2)
    expect(parsed.totalPages).toBe(3)
  })
})

describe('canonicalizeCollectionPath', () => {
  it('rewrites legacy list paths to canonical collection routes', () => {
    expect(canonicalizeCollectionPath('/api/sales')).toBe('/api/sale-orders')
    expect(canonicalizeCollectionPath('/api/purchase')).toBe('/api/purchase-orders')
    expect(canonicalizeCollectionPath('/api/purchases')).toBe('/api/purchase-orders')
    expect(canonicalizeCollectionPath('/api/activities')).toBe('/api/opportunity-activities')
    expect(canonicalizeCollectionPath('/api/sale-orders')).toBe('/api/sale-orders')
  })
})

describe('fetchCollection', () => {
  it('unwraps {items}, remaps aliases, and returns [] on 404', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input).startsWith('/api/sale-orders')) {
        return {
          ok: true,
          json: async () => ({ items: [{ id: 'so-1' }], total: 1, page: 1, limit: 50, totalPages: 1 }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const fromAlias = await fetchCollection('/api/sales')
      const missing = await fetchCollection('/api/not-a-real-collection')
      expect(fromAlias).toEqual([{ id: 'so-1' }])
      expect(missing).toEqual([])
      expect(String(fetchMock.mock.calls[0][0])).toContain('/api/sale-orders')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
