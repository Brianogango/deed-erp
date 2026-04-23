// Generic SWR hook that reads/writes any key from the server-store (SQLite KV).
// Use this to sync a specific localStorage collection to/from the server.
//
// Example:
//   const { data, sync } = useServerStore<Product[]>('deed_products')

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useServerStore<T>(key: string) {
  const url = `/api/store/${encodeURIComponent(key)}`
  const { data, error, isLoading, mutate } = useSWR<{ key: string; value: T }>(
    url, fetcher, { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )

  async function sync(value: T) {
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    mutate()
  }

  return { data: data?.value, isLoading, error, sync, refresh: () => mutate() }
}
