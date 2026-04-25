'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { AppProvider, useApp, User } from '@/lib/store'
import { Toast } from '@/components/ui'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'

function AppContent({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const router = useRouter()
  const { currentUserId, toast, sidebarOpen, toggleSidebar } = useApp()

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
