'use client'

import useSWR, { mutate as globalMutate } from 'swr'
import type { ApiProduct } from '@/app/api/products/route'

const PRODUCTS_KEY = '/api/products'

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

export interface UseProductsOptions {
  q?: string
  category?: string
  /** Polling interval in ms. Default 30 000 (30s) to sync with other users. */
  refreshInterval?: number
}

export function useProducts(options: UseProductsOptions = {}) {
  const { q, category, refreshInterval = 30_000 } = options
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (category) params.set('category', category)
  const key = `${PRODUCTS_KEY}${params.size ? `?${params}` : ''}`

  const { data, error, isLoading, mutate } = useSWR<{ products: ApiProduct[]; total: number }>(
    key,
    fetcher,
    { refreshInterval, revalidateOnFocus: false },
  )

  const createProduct = async (input: Partial<ApiProduct>) => {
    const res = await fetch(PRODUCTS_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw new Error(await res.text())
    await mutate()
    return (await res.json()).product as ApiProduct
  }

  const updateProduct = async (id: string, patch: Partial<ApiProduct>) => {
    const res = await fetch(`${PRODUCTS_KEY}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error(await res.text())
    await mutate()
  }

  const deleteProduct = async (id: string) => {
    const res = await fetch(`${PRODUCTS_KEY}/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await res.text())
    await mutate()
  }

  return {
    products: data?.products ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    mutate,
    createProduct,
    updateProduct,
    deleteProduct,
  }
}

/** Call from anywhere to invalidate all product caches (e.g. after a stock move). */
export const revalidateProducts = () => globalMutate((k: string) => typeof k === 'string' && k.startsWith(PRODUCTS_KEY), undefined, { revalidate: true })
