'use client'

import { useCallback, useEffect, useState, startTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type Options = {
  /** Query key for the open record (default `id`). */
  param?: string
  /** Extra query keys to set when opening (e.g. `{ tab: 'jobs' }`). */
  whenOpen?: Record<string, string>
  /** Extra query keys to remove when closing. */
  clearKeys?: string[]
}

export type SetUrlRecordIdOptions = {
  /**
   * Merge into the URL in the same replace as the id change.
   * `null` deletes the key. Use this so a clear cannot clobber a concurrent
   * tab switch that already updated local state but not searchParams yet.
   */
  queryPatch?: Record<string, string | null>
  /** Skip router.replace — only update local state (URL already correct). */
  localOnly?: boolean
}

/**
 * Persist an open list→detail record id in the URL so refresh / share keeps the same page.
 * Pattern matches Expenses / Outsource deep-links.
 *
 * Local state is updated immediately on setRecordId; URL sync only flows
 * searchParams → local when the URL actually changes (browser back/forward,
 * refresh). That way Back can clear the open record without the stale query
 * string reopening it before router.replace finishes.
 */
export function useUrlRecordId(options: Options = {}) {
  const param = options.param ?? 'id'
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const queryId = searchParams.get(param)
  const [recordId, setLocalRecordId] = useState<string | null>(queryId)

  const setRecordId = useCallback((id: string | null, opts?: SetUrlRecordIdOptions) => {
    setLocalRecordId(id)
    if (opts?.localOnly) return

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
    if (opts?.queryPatch) {
      for (const [key, value] of Object.entries(opts.queryPatch)) {
        if (value === null) params.delete(key)
        else params.set(key, value)
      }
    }
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }, [searchParams, router, pathname, param, options.whenOpen, options.clearKeys])

  useEffect(() => {
    setLocalRecordId(searchParams.get(param))
  }, [searchParams, param])

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
    params.set(param, next)
    const qs = params.toString()
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }, [searchParams, router, pathname, param])

  useEffect(() => {
    setLocalValue(searchParams.get(param) ?? fallback)
  }, [searchParams, param, fallback])

  return [value, setValue] as const
}
