import { describe, it, expect } from 'vitest'
import {
  parsePaginationParams,
  paginateArray,
  paginatedResponse,
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
