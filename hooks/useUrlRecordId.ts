'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type Options = {
  /** Query key for the open record (default `id`). */
  param?: string
  /** Extra query keys to set when opening (e.g. `{ tab: 'jobs' }`). */
  whenOpen?: Record<string, string>
  /** Extra query keys to remove when closing. */
  clearKeys?: string[]
}

/**
 * Persist an open list→detail record id in the URL so refresh / share keeps the same page.
 * Pattern matches Expenses / Outsource deep-links.
 */
export function useUrlRecordId(options: Options = {}) {
  const param = options.param ?? 'id'
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const queryId = searchParams.get(param)
  const [recordId, setLocalRecordId] = useState<string | null>(queryId)

  const setRecordId = useCallback((id: string | null) => {
    setLocalRecordId(id)
    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set(param, id)
      if (options.whenOpen) {
        for (const [key, value] of Object.entries(options.whenOpen)) {
          params.set(key, value)
        }
      }
    } else {
      params.delete(param)
      for (const key of options.clearKeys ?? []) params.delete(key)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, router, pathname, param, options.whenOpen, options.clearKeys])

  useEffect(() => {
    const urlId = searchParams.get(param)
    if (urlId !== recordId) setLocalRecordId(urlId)
  }, [searchParams, param, recordId])

  return [recordId, setRecordId] as const
}

/**
 * Sync a free-form query string value (e.g. tab) both ways with the URL.
 */
export function useUrlQueryState(param: string, fallback: string) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const queryValue = searchParams.get(param) ?? fallback
  const [value, setLocalValue] = useState(queryValue)

  const setValue = useCallback((next: string) => {
    setLocalValue(next)
    const params = new URLSearchParams(searchParams.toString())
    if (!next || next === fallback) {
      // Keep explicit tab values for clarity when non-default modules need them
      params.set(param, next)
    } else {
      params.set(param, next)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, router, pathname, param, fallback])

  useEffect(() => {
    const urlValue = searchParams.get(param) ?? fallback
    if (urlValue !== value) setLocalValue(urlValue)
  }, [searchParams, param, fallback, value])

  return [value, setValue] as const
}
