export function paginationParams(url: string | URL) {
  const searchParams = new URL(url).searchParams
  const pageRaw = Number(searchParams.get('page') ?? 1)
  const limitRaw = Number(searchParams.get('limit') ?? 50)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50
  const requested = ['page', 'limit', 'q', 'status'].some(key => searchParams.has(key))

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    q: searchParams.get('q')?.trim() ?? '',
    status: searchParams.get('status')?.trim() ?? '',
    requested,
    searchParams,
  }
}

export function paginateArray<T>(items: T[], page: number, limit: number) {
  const total = items.length
  const start = (page - 1) * limit
  return {
    items: items.slice(start, start + limit),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}
