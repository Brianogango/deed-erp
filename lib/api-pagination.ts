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

/** Normalise a list endpoint that may return a raw array or a paginated envelope. */
export function parseCollectionPayload<T>(data: unknown): PaginatedResponse<T> {
  if (Array.isArray(data)) {
    return paginatedResponse(data as T[], data.length, 1, data.length || PAGINATION_DEFAULT_LIMIT)
  }
  const obj = data && typeof data === 'object' ? data as Record<string, unknown> : null
  const items = Array.isArray(obj?.items) ? obj.items as T[] : []
  const total = Number(obj?.total)
  const page = Number(obj?.page) || 1
  const limit = Number(obj?.limit) || items.length || PAGINATION_DEFAULT_LIMIT
  return paginatedResponse(
    items,
    Number.isFinite(total) && total >= 0 ? total : items.length,
    page,
    limit,
  )
}

const FETCH_ALL_PAGE_CAP = 50

/**
 * Walk every page of a paginated collection endpoint.
 * Used for client boot so KPI / list counts are not a 200-row window.
 */
export async function fetchAllCollectionPages<T>(inputUrl: string): Promise<T[]> {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const url = new URL(inputUrl, origin)
  url.searchParams.set('limit', String(PAGINATION_MAX_LIMIT))
  const all: T[] = []
  let page = 1
  let totalPages = 1
  do {
    url.searchParams.set('page', String(page))
    const res = await fetch(`${url.pathname}${url.search}`)
    if (!res.ok) break
    const parsed = parseCollectionPayload<T>(await res.json().catch(() => null))
    all.push(...parsed.items)
    totalPages = Math.max(1, parsed.totalPages || 1)
    if (parsed.items.length === 0) break
    page += 1
  } while (page <= totalPages && page <= FETCH_ALL_PAGE_CAP)
  return all
}
