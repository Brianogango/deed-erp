'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { AppProvider, useApp, ModuleId, User } from '@/lib/store'
import { Toast } from '@/components/ui'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import Dashboard from '@/components/modules/Dashboard'
import Sales from '@/components/modules/Sales'
import CRM from '@/components/modules/CRM'
import Inventory from '@/components/modules/Inventory'
import Contacts from '@/components/modules/Contacts'
import Purchase from '@/components/modules/Purchase'
import POS from '@/components/modules/POS'
import Repair from '@/components/modules/Repair'
import Refurbishment from '@/components/modules/Refurbishment'
import Delivery from '@/components/modules/Delivery'
import Ecommerce from '@/components/modules/Ecommerce'
import Kilimall from '@/components/modules/Kilimall'
import Accounting from '@/components/modules/Accounting'
import HR from '@/components/modules/HR'
import Outsource from '@/components/modules/Outsource'
import Expenses from '@/components/modules/Expenses'
import SOPs from '@/components/modules/SOPs'
import LeaveApplication from '@/components/modules/LeaveApplication'
import MyDocuments from '@/components/modules/MyDocuments'
import AfterSales from '@/components/modules/AfterSales'

const moduleMap: Record<ModuleId, React.ComponentType> = {
  dashboard: Dashboard,
  sales: Sales,
  crm: CRM,
  inventory: Inventory,
  contacts: Contacts,
  purchase: Purchase,
  pos: POS,
  repair: Repair,
  refurbishment: Refurbishment,
  delivery: Delivery,
  ecommerce: Ecommerce,
  kilimall: Kilimall,
  accounting: Accounting,
  hr: HR,
  outsource: Outsource,
  expenses: Expenses,
  sops: SOPs,
  after_sales: AfterSales,
  leave: LeaveApplication,
  my_documents: MyDocuments,
}

function AppContent() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const router = useRouter()
  const { activeModule, currentUserId, toast, sidebarOpen, toggleSidebar } = useApp()

  useEffect(() => {
    if (!currentUserId) {
      router.replace('/login')
    }
  }, [currentUserId, router])

  if (!mounted) return <div style={{ minHeight: '100vh', background: '#F5F6FA' }} />

  if (!currentUserId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090b12] px-6 text-sm text-[#98a2b3]">
        Your session has ended. Redirecting to sign in.
      </div>
    )
  }

  const Module = moduleMap[activeModule] ?? Dashboard

  return (
    <div className="flex" style={{ height: '100vh', overflow: 'hidden' }}>
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
        <main className="flex-1 overflow-y-auto p-3 md:p-4 lg:p-5 xl:p-6">
          <Module />
        </main>
      </div>
      <Toast toast={toast} />
    </div>
  )
}

export default function AppShell({ initialUser, initialUsers }: { initialUser: User; initialUsers: User[] }) {
  return (
    <AppProvider initialUser={initialUser} initialUsers={initialUsers}>
      <AppContent />
    </AppProvider>
  )
}
