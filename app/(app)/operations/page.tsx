import { redirect } from 'next/navigation'

type SearchParams = Record<string, string | string[] | undefined>

function toQuery(searchParams?: SearchParams) {
  const params = new URLSearchParams()
  if (!searchParams) return ''
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
    } else if (typeof value === 'string') {
      params.set(key, value)
    }
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Legacy alias — canonical inventory lives at /inventory. */
export default function OperationsAliasPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  redirect(`/inventory${toQuery(searchParams)}`)
}
