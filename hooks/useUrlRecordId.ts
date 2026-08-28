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
  /**
   * Opening a record should normally add browser history so the browser Back
   * button returns to the parent list. Set to replace only for exceptional
   * flows that intentionally do not create a history entry.
   */
  openHistory?: 'push' | 'replace'
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
 * Local state is updated immediately on setRecordId. Opening a record pushes
 * one history entry by default; clearing/switching records replaces the current
 * URL so Back returns to the parent list without history spam. A module-level
 * pending map survives <Suspense> remounts so a click is not lost before router
 * navigation commits, and so stale searchParams cannot snap the page back.
 */
const pendingRecordIds = new Map<string, string | null>()

function pendingKey(pathname: string, param: string) {
  return `${pathname}::${param}`
}

export function useUrlRecordId(options: Options = {}) {
  const param = options.param ?? 'id'
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const queryId = searchParams.get(param)
  const key = pendingKey(pathname, param)
  const [recordId, setLocalRecordId] = useState<string | null>(() => (
    pendingRecordIds.has(key) ? pendingRecordIds.get(key)! : queryId
  ))

  const setRecordId = useCallback((id: string | null, opts?: SetUrlRecordIdOptions) => {
    setLocalRecordId(id)
    if (opts?.localOnly) return

    pendingRecordIds.set(pendingKey(pathname, param), id)

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
    const target = qs ? `${pathname}?${qs}` : pathname
    const openingFromList = Boolean(id) && !recordId
    const shouldPush = openingFromList && (options.openHistory ?? 'push') === 'push'
    startTransition(() => {
      if (shouldPush) router.push(target, { scroll: false })
      else router.replace(target, { scroll: false })
    })
  }, [
    searchParams,
    router,
    pathname,
    param,
    recordId,
    options.whenOpen,
    options.clearKeys,
    options.openHistory,
  ])

  useEffect(() => {
    const urlId = searchParams.get(param)
    const mapKey = pendingKey(pathname, param)
    if (pendingRecordIds.has(mapKey)) {
      const pending = pendingRecordIds.get(mapKey) ?? null
      if (pending !== urlId) {
        setLocalRecordId(pending)
        return
      }
      pendingRecordIds.delete(mapKey)
    }
    setLocalRecordId(urlId)
  }, [searchParams, param, pathname])

  useEffect(() => {
    const onPopState = () => {
      pendingRecordIds.delete(pendingKey(pathname, param))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [pathname, param])

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
