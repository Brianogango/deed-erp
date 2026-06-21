'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

import { AppProvider, useApp, User } from '@/lib/store'
import { Toast } from '@/components/ui'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

// Auto-logout after 30 minutes of inactivity
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000
// Warn 2 minutes before auto-logout
const WARN_BEFORE_MS = 2 * 60 * 1000

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Offline Banner Component
 * Displays a non-blocking informational banner when network is lost.
 * Does NOT log the user out — all changes are queued in localStorage and
 * will sync automatically when connectivity is restored.
 */
function OfflineBanner() {
  return (
    <div
      className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-2.5 px-4 py-2 text-[11px] font-semibold shadow-md"
      style={{ background: '#92400E', color: '#FEF3C7', animation: 'slideDown 0.2s ease-out' }}
    >
      <span
        style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: '#FCD34D', boxShadow: '0 0 0 0 rgba(252,211,77,0.6)',
          animation: 'offlinePulse 1.8s ease-in-out infinite',
        }}
      />
      No internet connection — your changes are saved locally and will sync when you reconnect
    </div>
  )
}

/**
 * Inactivity Warning Modal Component
 * Warns user before auto-logout due to inactivity
 */
function InactivityWarningModal({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--bg-card)] rounded-2xl shadow-2xl p-6 mx-4 max-w-sm w-full text-center">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <h3 className="text-base font-bold text-[var(--text-1)] mb-1">Still there?</h3>
        <p className="text-xs text-[var(--text-3)] mb-5">
          You&apos;ve been inactive for a while. You will be signed out in 2 minutes unless you continue.
        </p>
        <button className="btn-primary w-full py-2.5 text-sm" onClick={onContinue}>
          Continue Session
        </button>
      </div>
    </div>
  )
}

/**
 * Sidebar Overlay Backdrop Component
 * Closes sidebar when clicked on mobile
 */
function SidebarBackdrop({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 md:hidden transition-opacity duration-200"
      onClick={onClose}
    />
  )
}

function AppBootSkeleton() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-page)] animate-pulse">
      <aside className="hidden md:flex w-sidebar flex-col border-r border-border-lt bg-card p-4">
        <div className="h-10 w-32 rounded-xl bg-muted mb-6" />
        <div className="space-y-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-9 rounded-xl bg-muted" style={{ width: `${70 + (i % 3) * 10}%` }} />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-topbar border-b border-border-lt bg-card px-4 flex items-center justify-between">
          <div className="h-8 w-40 rounded-xl bg-muted" />
          <div className="flex gap-2">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="h-8 w-24 rounded-xl bg-muted" />
          </div>
        </div>
        <main className="flex-1 p-3 md:p-4 lg:p-5 xl:p-6">
          <div className="mod-page gap-4">
            <div className="mod-header">
              <div className="h-9 w-56 rounded-xl bg-muted" />
              <div className="h-9 w-28 rounded-xl bg-muted" />
            </div>
            <div className="stat-grid-4 px-4 py-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted" />
              ))}
            </div>
            <div className="mx-4 h-80 rounded-2xl bg-muted" />
          </div>
        </main>
      </div>
    </div>
  )
}

function PublicPageSkeleton() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#090b12] px-4">
      <div className="h-12 w-12 rounded-2xl bg-white/10 animate-pulse" />
    </div>
  )
}

/**
 * Main App Content Component
 * Manages layout, session, and auth state
 */
function AppContent({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const router = useRouter()
  const pathname = usePathname()
  const { currentUserId, currentUser, toast, sidebarOpen, toggleSidebar, logout, showToast } = useApp()

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLElement>(null)
  const [showInactivityWarning, setShowInactivityWarning] = useState(false)
  const [offlineBanner, setOfflineBanner] = useState(false)
  const isPublicRepairTracker =
    pathname === '/track' ||
    pathname.startsWith('/track/') ||
    pathname.startsWith('/portal/repair')

  const applyResponsiveTableLabels = useCallback(() => {
    const scope = contentRef.current
    if (!scope) return

    const getFallbackLabel = (labels: string[], index: number, total: number) => {
      const cleaned = labels[index]?.trim()
      if (cleaned) return cleaned
      const isLastColumn = index === total - 1
      return isLastColumn ? 'Actions' : `Column ${index + 1}`
    }

    const pickVisibleIndices = (labels: string[], total: number) => {
      const visible = new Set<number>()
      if (total === 0) return visible
      visible.add(0)
      if (total > 1) visible.add(1)
      const last = total - 1
      const statusDateRe = /(status|date|due|time|created|updated|eta|aging|age)/i
      labels.forEach((label, index) => {
        if (index <= 1 || index === last) return
        if (statusDateRe.test(label) && visible.size < 4) visible.add(index)
      })
      for (let index = 2; index < last && visible.size < 4; index += 1) {
        visible.add(index)
      }
      if (last > 1) visible.add(last)
      return visible
    }

    const applyMobileCardHierarchy = (
      row: HTMLElement,
      cells: HTMLElement[],
      labels: string[],
    ) => {
      const visible = pickVisibleIndices(labels, cells.length)
      let hiddenCount = 0

      cells.forEach((cell, index) => {
        cell.setAttribute('data-label', getFallbackLabel(labels, index, cells.length))
        if (visible.has(index)) {
          cell.removeAttribute('data-mobile-extra')
        } else {
          cell.setAttribute('data-mobile-extra', 'true')
          hiddenCount += 1
        }
      })

      row.classList.toggle('mobile-overflow-row', hiddenCount > 0)
      const firstCell = cells[0]
      if (!firstCell) return

      const existingToggle = firstCell.querySelector<HTMLButtonElement>('.mobile-row-toggle')
      if (hiddenCount === 0) {
        existingToggle?.remove()
        row.classList.remove('mobile-expanded')
        return
      }

      const toggle = existingToggle ?? document.createElement('button')
      if (!existingToggle) {
        toggle.type = 'button'
        toggle.className = 'mobile-row-toggle'
        toggle.setAttribute('aria-label', 'Show row details')
        toggle.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const expanded = row.classList.toggle('mobile-expanded')
          toggle.textContent = expanded ? 'Less' : 'Details'
          toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
        })
        firstCell.appendChild(toggle)
      }

      const expanded = row.classList.contains('mobile-expanded')
      toggle.textContent = expanded ? 'Less' : 'Details'
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    }

    const tables = scope.querySelectorAll<HTMLTableElement>('table:not([data-no-responsive])')
    tables.forEach((table) => {
      table.classList.add('erp-responsive-table')

      const headerCells = Array.from(table.querySelectorAll('thead tr:first-child th'))
      const labels = headerCells.map((cell) => cell.textContent?.trim() ?? '')

      table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
        const cells = Array.from(row.cells).map((cell) => cell as HTMLElement)
        applyMobileCardHierarchy(row, cells, labels)
      })

      table.querySelectorAll<HTMLTableRowElement>('tfoot tr').forEach((row) => {
        const cells = Array.from(row.cells).map((cell) => cell as HTMLElement)
        applyMobileCardHierarchy(row, cells, labels)
      })
    })

    const gridHeads = scope.querySelectorAll<HTMLElement>('.table-head')
    gridHeads.forEach((head) => {
      const labels = Array.from(head.children).map((cell) => (cell.textContent ?? '').trim())
      const possibleContainer =
        head.closest<HTMLElement>('.table-scroll, .dt-scroll, [class*="overflow-x-auto"]') ??
        head.parentElement
      if (!possibleContainer) return
      possibleContainer.classList.add('responsive-table')

      const rowScope = head.parentElement ?? possibleContainer
      let rows = rowScope.querySelectorAll<HTMLElement>(':scope > .table-row')
      if (rows.length === 0) {
        rows = rowScope.querySelectorAll<HTMLElement>('.table-row')
      }
      rows.forEach((row) => {
        const cells = Array.from(row.children).filter(
          (cell): cell is HTMLElement => cell instanceof HTMLElement,
        )
        applyMobileCardHierarchy(row, cells, labels)
      })
    })
  }, [])

  // Lock body scroll when mobile sidebar drawer is open
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  // Smooth scroll-to-top on route change
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [pathname])

  useEffect(() => {
    if (!mounted || isPublicRepairTracker) return
    applyResponsiveTableLabels()

    const scope = contentRef.current
    if (!scope) return
    const observer = new MutationObserver(() => {
      applyResponsiveTableLabels()
    })

    observer.observe(scope, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [mounted, pathname, isPublicRepairTracker, applyResponsiveTableLabels])

  /**
   * Handle logout with reason tracking
   */
  const doLogout = useCallback(
    async (reason: 'inactivity' | 'network') => {
      setShowInactivityWarning(false)
      await logout()
      router.replace(`/login?reason=${reason}`)
    },
    [logout, router]
  )

  /**
   * Reset inactivity timer on user activity
   */
  const resetInactivityTimer = useCallback(() => {
    if (!currentUserId) return
    setShowInactivityWarning(false)
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    if (warnTimer.current) clearTimeout(warnTimer.current)

    warnTimer.current = setTimeout(() => {
      setShowInactivityWarning(true)
    }, INACTIVITY_TIMEOUT_MS - WARN_BEFORE_MS)

    inactivityTimer.current = setTimeout(() => {
      void doLogout('inactivity')
    }, INACTIVITY_TIMEOUT_MS)
  }, [currentUserId, doLogout])

  /**
   * Inactivity auto-logout effect
   */
  useEffect(() => {
    if (!currentUserId) return
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    events.forEach(e => window.addEventListener(e, resetInactivityTimer, { passive: true }))
    resetInactivityTimer()
    return () => {
      events.forEach(e => window.removeEventListener(e, resetInactivityTimer))
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      if (warnTimer.current) clearTimeout(warnTimer.current)
    }
  }, [currentUserId, resetInactivityTimer])

  /**
   * Network connectivity banner.
   * Shows an informational amber bar when offline; dismisses it and toasts
   * "Back online" when connectivity is restored. Does NOT log the user out —
   * the store's StoreProvider handles flushing queued writes on reconnect.
   */
  useEffect(() => {
    if (!currentUserId) return

    const handleOffline = () => setOfflineBanner(true)

    const handleOnline = () => {
      setOfflineBanner(false)
      showToast('Back online — syncing changes…')
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [currentUserId, showToast])

  /**
   * Auth state and route guard effect
   */
  useEffect(() => {
    if (!currentUserId) {
      router.replace('/login')
    }
  }, [currentUserId, currentUser, router, pathname])

  // Hydration guard
  if (!mounted) {
    return isPublicRepairTracker ? <PublicPageSkeleton /> : <AppBootSkeleton />
  }

  // Not authenticated
  if (!currentUserId) {
    return (
      <div className="
        flex min-h-screen items-center justify-center
        bg-[var(--bg-page)] px-6 text-sm text-[var(--text-3)]
      ">
        Your session has ended. Redirecting to sign in.
      </div>
    )
  }

  if (isPublicRepairTracker) {
    return (
      <>
        {children}
        <Toast toast={toast} />
      </>
    )
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-page)]">
      {/* Network Offline Banner */}
      {offlineBanner && <OfflineBanner />}

      {/* Inactivity Warning Modal */}
      {showInactivityWarning && <InactivityWarningModal onContinue={resetInactivityTimer} />}

      {/* Sidebar Overlay Backdrop */}
      {sidebarOpen && <SidebarBackdrop onClose={toggleSidebar} />}

      {/* Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <Topbar />

        {/* Main Content */}
        <main
          ref={contentRef}
          className="
            flex-1 overflow-y-auto overflow-x-hidden
            p-3 md:p-4 lg:p-5 xl:p-6
            transition-all duration-200
          "
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          <div key={pathname} className="view-enter">
            {children}
          </div>
        </main>
      </div>

      {/* Toast Notifications */}
      <Toast toast={toast} />
    </div>
  )
}

/**
 * AppShell Wrapper Component
 * Provides app context and initializes state
 */
export default function AppShell({
  initialUser,
  initialUsers,
  serverState,
  children,
}: {
  initialUser: User
  initialUsers: User[]
  serverState?: Record<string, unknown> | any
  children: React.ReactNode
}) {
  return (
    <AppProvider initialUser={initialUser} initialUsers={initialUsers} serverState={serverState}>
      <AppContent>{children}</AppContent>
    </AppProvider>
  )
}
