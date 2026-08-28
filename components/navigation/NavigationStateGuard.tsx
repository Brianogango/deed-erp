'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const STORAGE_PREFIX = 'deed:last-module-list:'
const EXCLUDED_ROOTS = new Set(['/api', '/login', '/portal', '/track'])

function moduleRoot(pathname: string): string | null {
  if (!pathname || pathname === '/') return '/'
  const first = pathname.split('/').filter(Boolean)[0]
  if (!first) return '/'
  const root = `/${first}`
  return EXCLUDED_ROOTS.has(root) ? null : root
}

function fullUrl(pathname: string, search: string) {
  return search ? `${pathname}?${search}` : pathname
}

/**
 * Keeps the parent list/tab context for route-backed detail pages.
 *
 * Example:
 *   /finance?tab=invoices -> /finance/invoices/123 -> Back action pushes /finance
 *
 * Instead of losing the user's context and rendering Finance Dashboard, this
 * guard restores /finance?tab=invoices because the transition came from a
 * nested route in the same module. Sidebar navigation from another module is
 * intentionally unaffected.
 */
export default function NavigationStateGuard() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const previousUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const search = searchParams.toString()
    const currentUrl = fullUrl(pathname, search)
    const root = moduleRoot(pathname)
    const previousUrl = previousUrlRef.current

    if (root && pathname === root && search) {
      // Remember list/tab/filter state, but not a record-detail query.
      const hasRecordId = searchParams.has('id') || searchParams.has('recordId')
      if (!hasRecordId) {
        sessionStorage.setItem(`${STORAGE_PREFIX}${root}`, currentUrl)
      }
    }

    if (root && pathname === root && !search && previousUrl) {
      const previousPath = previousUrl.split('?')[0]
      const returnedFromNestedRoute = previousPath.startsWith(`${root}/`)
      if (returnedFromNestedRoute) {
        const remembered = sessionStorage.getItem(`${STORAGE_PREFIX}${root}`)
        if (remembered && remembered !== root && remembered.startsWith(`${root}?`)) {
          previousUrlRef.current = remembered
          router.replace(remembered, { scroll: false })
          return
        }
      }
    }

    previousUrlRef.current = currentUrl
  }, [pathname, router, searchParams])

  return null
}
