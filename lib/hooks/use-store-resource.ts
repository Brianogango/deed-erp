'use client'

import useSWR, { mutate as globalMutate } from 'swr'

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

export interface UseResourceOptions {
  params?: Record<string, string>
  /** Polling interval in ms. Default 30s to sync across users. Pass 0 to disable. */
  refreshInterval?: number
  disabled?: boolean
}

export interface UseResourceResult<T> {
  items: T[]
  total: number
  isLoading: boolean
  error: Error | undefined
  mutate: () => Promise<unknown>
  create: (body: Partial<T>) => Promise<T>
  update: (id: string, patch: Partial<T>) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Generic SWR hook factory for any `app_state`-backed API resource.
 *
 * Usage:
 *   const useSaleOrders = makeResourceHook<SaleOrder>('/api/sale-orders')
 *   const { items, create, update, remove } = useSaleOrders({ params: { status: 'quotation' } })
 */
export function makeResourceHook<T extends { id: string }>(basePath: string) {
  return function useResource(options: UseResourceOptions = {}): UseResourceResult<T> {
    const { params, refreshInterval = 30_000, disabled = false } = options

    const search = params ? new URLSearchParams(params).toString() : ''
    const key = disabled ? null : `${basePath}${search ? `?${search}` : ''}`

    const { data, error, isLoading, mutate } = useSWR<{ items: T[]; total: number }>(
      key,
      fetcher,
      { refreshInterval, revalidateOnFocus: false },
    )

    const create = async (body: Partial<T>): Promise<T> => {
      const res = await fetch(basePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const { item } = await res.json()
      await mutate()
      return item as T
    }

    const update = async (id: string, patch: Partial<T>): Promise<void> => {
      const res = await fetch(`${basePath}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await res.text())
      await mutate()
    }

    const remove = async (id: string): Promise<void> => {
      const res = await fetch(`${basePath}/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      await mutate()
    }

    return {
      items: data?.items ?? [],
      total: data?.total ?? 0,
      isLoading,
      error,
      mutate,
      create,
      update,
      remove,
    }
  }
}

/**
 * Invalidate all SWR cache entries for a given API base path.
 * Call this after mutations that affect multiple components (e.g. a stock move
 * should invalidate both /api/products and /api/sale-orders).
 */
export function revalidateResource(basePath: string) {
  return globalMutate(
    (k: unknown) => typeof k === 'string' && k.startsWith(basePath),
    undefined,
    { revalidate: true },
  )
}
