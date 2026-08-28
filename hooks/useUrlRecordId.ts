'use client'

import { useCallback, useEffect, useState, startTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { decideRecordNavigation, type RecordHistoryOverride } from '@/lib/navigation-history'

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
  /** Skip navigation — only update local state (URL already correct). */
  localOnly?: boolean
  /** Override the default history behavior for exceptional flows. */
  history?: RecordHistoryOverride
}

/**
 * Persist an open list→detail record id in the URL so refresh / share keeps the same page.
 *
 * History semantics are deliberate:
 * - opening a record from a list PUSHES a history entry, so browser Back returns
 *   to the exact list/filter/tab URL the user came from;
 * - switching one open record to another REPLACES the detail entry;
 * - the module's own Back/Close action uses browser Back when this hook created
 *   the detail entry, otherwise it safely strips the id in-place (deep link / refresh).
 *
 * Local state is updated immediately. A module-level pending map survives
 * <Suspense> remounts so a click is not lost before navigation commits.
 */
const pendingRecordIds = new Map<string, string | null>()
const pushedDetailKeys = new Set<string>()

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

    const mapKey = pendingKey(pathname, param)
    pendingRecordIds.set(mapKey, id)

    const decision = decideRecordNavigation({
      nextId: id,
      currentQueryId: queryId,
      openedViaPush: pushedDetailKeys.has(mapKey),
      history: opts?.history,
    })

    if (decision === 'back') {
      pushedDetailKeys.delete(mapKey)
      startTransition(() => router.back())
      return
    }

    const params = new URLSearchParams(searchParams.toString())
    if (id) {
      params.set(param, id)
      if (options.whenOpen) {
        for (const [queryKey, value] of Object.entries(options.whenOpen)) {
          params.set(queryKey, value)
        }
      }
    } else {
      params.delete(param)
      for (const clearKey of options.clearKeys ?? []) params.delete(clearKey)
    }
    if (opts?.queryPatch) {
      for (const [queryKey, value] of Object.entries(opts.queryPatch)) {
        if (value === null) params.delete(queryKey)
        else params.set(queryKey, value)
      }
    }

    const qs = params.toString()
    const target = qs ? `${pathname}?${qs}` : pathname
    if (decision === 'push') pushedDetailKeys.add(mapKey)

    startTransition(() => {
      if (decision === 'push') router.push(target, { scroll: false })
      else router.replace(target, { scroll: false })
    })
  }, [searchParams, router, pathname, param, queryId, options.whenOpen, options.clearKeys])

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
      const mapKey = pendingKey(pathname, param)
      pendingRecordIds.delete(mapKey)
      pushedDetailKeys.delete(mapKey)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [pathname, param])

  return [recordId, setRecordId] as const
}

/**
 * Sync a free-form query string value (e.g. tab) both ways with the URL.
 * Tab changes intentionally replace the current history entry; opening records
 * is what creates navigable history. This prevents tab-click spam in Back.
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
