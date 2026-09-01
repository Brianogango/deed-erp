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
   * Merge into the URL in the same navigation as the id change.
   * `null` deletes the key. Use this so a clear cannot clobber a concurrent
   * tab switch that already updated local state but not searchParams yet.
   */
  queryPatch?: Record<string, string | null>
  /** Skip router navigation — only update local state (URL already correct). */
  localOnly?: boolean
  /** User navigation should normally push; use replace only for canonicalization/repair. */
  history?: 'push' | 'replace'
}

/**
 * Persist an open list→detail record id in the URL so refresh / share keeps the same page.
 * Pattern matches Expenses / Outsource deep-links.
 *
 * Local state is updated immediately on setRecordId. A module-level pending map
 * survives <Suspense> remounts so a click is not lost before router.replace
 * commits, and so a stale empty searchParams cannot snap the page back to list.
 */
const pendingRecordIds = new Map<string, string | null>()

/**
 * Latest optimistic query string per pathname. Multiple URL-backed controls can
 * update in the same event (e.g. search changes then DataTable resets page).
 * Building each navigation from stale useSearchParams would otherwise let the
 * second update erase the first. Keep a tiny pending snapshot until the router
 * catches up so same-tick patches compose atomically.
 */
const pendingQueryStrings = new Map<string, string>()

function queryParamsBase(pathname: string, searchParams: { toString(): string }) {
  const pending = pendingQueryStrings.get(pathname)
  return new URLSearchParams(pending !== undefined ? pending : searchParams.toString())
}

function rememberPendingQuery(pathname: string, params: URLSearchParams) {
  pendingQueryStrings.set(pathname, params.toString())
}

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

    const params = queryParamsBase(pathname, searchParams)
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
    rememberPendingQuery(pathname, params)
    const href = qs ? `${pathname}?${qs}` : pathname
    startTransition(() => {
      if (opts?.history === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    })
  }, [searchParams, router, pathname, param, options.whenOpen, options.clearKeys])

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
      pendingQueryStrings.delete(pathname)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [pathname, param])

  return [recordId, setRecordId] as const
}

/**
 * Sync a free-form query string value (e.g. tab) both ways with the URL.
 */
export type SetUrlQueryStateOptions = {
  history?: 'push' | 'replace'
  queryPatch?: Record<string, string | null>
}

/**
 * Sync a free-form query string value (e.g. tab) both ways with the URL.
 * User navigation defaults to push. For list UI state (search/filter/page),
 * prefer useUrlUiState below so typing and filtering do not pollute Back.
 */
export function useUrlQueryState(param: string, fallback: string) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const queryValue = searchParams.get(param) ?? fallback
  const [value, setLocalValue] = useState(queryValue)

  const setValue = useCallback((next: string | null, opts?: SetUrlQueryStateOptions) => {
    setLocalValue(next ?? fallback)
    const params = queryParamsBase(pathname, searchParams)
    if (next === null) params.delete(param)
    else params.set(param, next)
    if (opts?.queryPatch) {
      for (const [key, value] of Object.entries(opts.queryPatch)) {
        if (value === null) params.delete(key)
        else params.set(key, value)
      }
    }
    const qs = params.toString()
    rememberPendingQuery(pathname, params)
    const href = qs ? `${pathname}?${qs}` : pathname
    startTransition(() => {
      if (opts?.history === 'replace') router.replace(href, { scroll: false })
      else router.push(href, { scroll: false })
    })
  }, [searchParams, router, pathname, param, fallback])

  useEffect(() => {
    const actual = searchParams.toString()
    const pending = pendingQueryStrings.get(pathname)
    if (pending !== undefined && pending !== actual) {
      const optimistic = new URLSearchParams(pending)
      setLocalValue(optimistic.get(param) ?? fallback)
      return
    }
    if (pending === actual) pendingQueryStrings.delete(pathname)
    setLocalValue(searchParams.get(param) ?? fallback)
  }, [searchParams, param, fallback, pathname])

  return [value, setValue] as const
}


/**
 * URL-backed state for list controls such as search, filters, sort/layout and
 * pagination. These changes REPLACE the current history entry so:
 *   list(search/filter/page) -> record -> Back
 * returns to the exact list state without making Back replay every keystroke.
 *
 * Default/empty values are removed from the query string to keep deep links
 * compact and canonical.
 */
export function useUrlUiState(param: string, fallback: string) {
  const [value, setQueryValue] = useUrlQueryState(param, fallback)

  const setValue = useCallback((
    next: string,
    opts?: { queryPatch?: Record<string, string | null> },
  ) => {
    const normalized = next === fallback || next === '' ? null : next
    setQueryValue(normalized, {
      history: 'replace',
      queryPatch: opts?.queryPatch,
    })
  }, [fallback, setQueryValue])

  return [value, setValue] as const
}


/**
 * Atomically replace several URL-backed UI controls. Use this for "Clear all"
 * and any interaction that changes multiple list controls at once; it avoids
 * one setter overwriting another from a stale searchParams snapshot.
 */
export function useUrlUiPatch() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  return useCallback((patch: Record<string, string | null>) => {
    const params = queryParamsBase(pathname, searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }
    const qs = params.toString()
    rememberPendingQuery(pathname, params)
    const href = qs ? `${pathname}?${qs}` : pathname
    startTransition(() => {
      router.replace(href, { scroll: false })
    })
  }, [pathname, router, searchParams])
}
