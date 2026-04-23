import useSWR from 'swr'
import type { Contact } from '@/lib/store'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export interface ContactsResponse {
  items: Contact[]
  total: number
  page: number
  limit: number
}

export function useContacts(params?: { q?: string; type?: 'customer' | 'vendor'; page?: number }) {
  const query = new URLSearchParams()
  if (params?.q)    query.set('q', params.q)
  if (params?.type) query.set('type', params.type)
  if (params?.page) query.set('page', String(params.page))

  const url = `/api/contacts${query.size ? `?${query}` : ''}`
  const { data, error, isLoading, mutate } = useSWR<ContactsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })

  return {
    contacts:  data?.items ?? [],
    total:     data?.total ?? 0,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
