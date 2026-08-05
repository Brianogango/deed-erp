/**
 * Shared list pagination helpers (AGENT-PERF-001).
 * Default page=1, limit=50; hard cap limit=200.
 */

export const PAGINATION_DEFAULT_LIMIT = 50
export const PAGINATION_MAX_LIMIT = 200

export type PaginationParams = {
  page: number
  limit: number
  skip: number
  sort: string | null
  order: 'asc' | 'desc'
}

export type PaginatedResponse<T> = {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export function parsePaginationParams(
  searchParams: URLSearchParams,
  options?: { defaultSort?: string; allowedSorts?: string[] },
): PaginationParams {
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? String(PAGINATION_DEFAULT_LIMIT), 10) || PAGINATION_DEFAULT_LIMIT
  const limit = Math.min(PAGINATION_MAX_LIMIT, Math.max(1, rawLimit))

  const orderRaw = (searchParams.get('order') ?? 'desc').toLowerCase()
  const order: 'asc' | 'desc' = orderRaw === 'asc' ? 'asc' : 'desc'

  const requestedSort = searchParams.get('sort')?.trim() || options?.defaultSort || null
  const allowed = options?.allowedSorts
  const sort =
    requestedSort && (!allowed || allowed.includes(requestedSort))
      ? requestedSort
      : (options?.defaultSort ?? null)

  return { page, limit, skip: (page - 1) * limit, sort, order }
}

export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  return {
    items,
    total,
    page,
    limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  }
}

/** Slice an already-filtered in-memory collection (blob-backed lists). */
export function paginateArray<T>(
  items: T[],
  page: number,
  limit: number,
): PaginatedResponse<T> {
  const total = items.length
  const start = (page - 1) * limit
  return paginatedResponse(items.slice(start, start + limit), total, page, limit)
}
