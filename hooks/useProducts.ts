import useSWR from 'swr'
import type { Product } from '@/lib/store'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export interface ProductsResponse {
  items: Product[]
  total: number
  page: number
  limit: number
}

export function useProducts(params?: { q?: string; category?: string; page?: number }) {
  const query = new URLSearchParams()
  if (params?.q)        query.set('q', params.q)
  if (params?.category) query.set('category', params.category)
  if (params?.page)     query.set('page', String(params.page))

  const url = `/api/products${query.size ? `?${query}` : ''}`
  const { data, error, isLoading, mutate } = useSWR<ProductsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  return {
    products:  data?.items ?? [],
    total:     data?.total ?? 0,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
