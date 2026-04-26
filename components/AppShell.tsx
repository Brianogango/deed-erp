'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { AppProvider, useApp, User } from '@/lib/store'
import { Toast } from '@/components/ui'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'

// Auto-logout after 30 minutes of inactivity
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000
// Warn 2 minutes before auto-logout
const WARN_BEFORE_MS = 2 * 60 * 1000
// Grace period before logging out on network loss (5 seconds)
const OFFLINE_GRACE_MS = 5 * 1000

function AppContent({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const router = useRouter()
  const { currentUserId, toast, sidebarOpen, toggleSidebar, logout } = useApp()

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showInactivityWarning, setShowInactivityWarning] = useState(false)
  const [offlineBanner, setOfflineBanner] = useState(false)

  const doLogout = useCallback(async (reason: 'inactivity' | 'network') => {
    setShowInactivityWarning(false)
    await logout()
    router.replace(`/login?reason=${reason}`)
  }, [logout, router])

  // ── Inactivity auto-logout ────────────────────────────────────────────────
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

  // ── Network loss auto-logout ──────────────────────────────────────────────
  useEffect(() => {
    if (!currentUserId) return

    const handleOffline = () => {
      setOfflineBanner(true)
      offlineTimer.current = setTimeout(() => {
        void doLogout('network')
      }, OFFLINE_GRACE_MS)
    }

    const handleOnline = () => {
      setOfflineBanner(false)
      if (offlineTimer.current) clearTimeout(offlineTimer.current)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      if (offlineTimer.current) clearTimeout(offlineTimer.current)
    }
  }, [currentUserId, doLogout])

  useEffect(() => {
    if (!currentUserId) {
      router.replace('/login')
    }
  }, [currentUserId, router])

  if (!mounted) return <div className="h-screen w-full bg-[#F4F6FA]" />

  if (!currentUserId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090b12] px-6 text-sm text-[#98a2b3]">
        Your session has ended. Redirecting to sign in.
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F4F6FA]">
      {/* Network offline banner */}
      {offlineBanner && (
        <div className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-white text-[12px] font-semibold shadow-lg">
          <span>⚠ No internet connection — you will be signed out in {OFFLINE_GRACE_MS / 1000} seconds</span>
        </div>
      )}

      {/* Inactivity warning modal */}
      {showInactivityWarning && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 mx-4 max-w-sm w-full text-center">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⏱</span>
            </div>
            <h3 className="text-[15px] font-bold text-gray-900 mb-1">Still there?</h3>
            <p className="text-[12px] text-gray-500 mb-5">
              You&apos;ve been inactive for a while. You will be signed out in 2 minutes unless you continue.
            </p>
            <button
              className="w-full py-2.5 rounded-xl bg-[#1B2762] hover:bg-[#14204F] text-white text-[13px] font-semibold transition-colors"
              onClick={resetInactivityTimer}
            >
              Continue Session
            </button>
          </div>
        </div>
      )}

      {/* Backdrop for mobile/tablet sidebar overlay (≤ 768px) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={toggleSidebar}
        />
      )}
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar />
        {/* Responsive padding: phone=12px, tablet=16px, laptop=20px, desktop=24px */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4 lg:p-5 xl:p-6">
          {children}
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  )
}

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
