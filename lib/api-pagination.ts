/**
 * Shared list pagination helpers (AGENT-PERF-001).
 * Default page=1, limit=50; hard cap limit=200.
 */

export const PAGINATION_DEFAULT_LIMIT = 50
export const PAGINATION_MAX_LIMIT = 200

type PaginationParams = {
  page: number
  limit: number
  skip: number
  sort: string | null
  order: 'asc' | 'desc'
}

type PaginatedResponse<T> = {
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

/** Legacy / shorthand list paths → canonical collection routes. */
const COLLECTION_PATH_ALIASES: Record<string, string> = {
  '/api/sales': '/api/sale-orders',
  '/api/purchase': '/api/purchase-orders',
  '/api/purchases': '/api/purchase-orders',
  '/api/activities': '/api/opportunity-activities',
}

export function canonicalizeCollectionPath(pathname: string): string {
  const path = (pathname || '').split('?')[0]
  return COLLECTION_PATH_ALIASES[path] ?? path
}

function collectionRequestUrl(inputUrl: string): { pathname: string; search: string; url: URL } {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const url = new URL(inputUrl, origin)
  url.pathname = canonicalizeCollectionPath(url.pathname)
  return { pathname: url.pathname, search: url.search, url }
}

/**
 * GET a list endpoint as an array. Unwraps `{ items }`, remaps known aliases,
 * and treats 404 / non-OK / network failure as `[]` so boot never crashes or
 * overwrites last-known KPI state with `undefined`.
 */
export async function fetchCollection<T>(inputUrl: string): Promise<T[]> {
  try {
    const { pathname, search } = collectionRequestUrl(inputUrl)
    const res = await fetch(`${pathname}${search}`)
    if (!res.ok) return []
    return parseCollectionPayload<T>(await res.json().catch(() => null)).items
  } catch {
    return []
  }
}
