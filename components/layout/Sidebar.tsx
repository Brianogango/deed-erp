'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fa } from '@/components/icons'
import { 
  faChartLine, faShoppingCart, faBuildingColumns, faUsers, faGear, faBoxesStacked, faScrewdriverWrench,
  faDesktop, faGlobe, faAddressBook, faCartShopping, faTruck, faArrowsRotate, faShieldHalved, faReceipt 
} from '@fortawesome/free-solid-svg-icons'
import { useApp, ModuleId } from '@/lib/store'
import { hasModuleAccess } from '@/lib/auth/access'

export default function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, getVisibleRepairs, users, currentUserId, activeModule, setModule } = useApp()

  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role || ''

  const pendingRepairs = getVisibleRepairs().filter(r => ['received', 'assigned'].includes(r.status)).length

  const navItems = [
    { label: 'Dashboard',     href: '/',              id: 'dashboard',     icon: faChartLine },
    { label: 'Sales & CRM',   href: '/sales',         id: 'sales',         icon: faShoppingCart },
    { label: 'POS',           href: '/pos',           id: 'pos',           icon: faDesktop },
    { label: 'E-commerce',    href: '/ecommerce',     id: 'ecommerce',     icon: faGlobe },
    { label: 'Kilimall',      href: '/kilimall',      id: 'kilimall',      icon: faGlobe },
    { label: 'Contacts',      href: '/contacts',      id: 'contacts',      icon: faAddressBook },
    { label: role === 'admin' ? 'Operations' : 'Inventory', href: '/operations', id: 'inventory', icon: faBoxesStacked },
    { label: 'Purchases',     href: '/purchases',     id: 'purchase',      icon: faCartShopping },
    { label: 'Delivery',      href: '/delivery',      id: 'delivery',      icon: faTruck },
    { label: 'Repairs',       href: '/repairs',       id: 'repair',        icon: faScrewdriverWrench, badge: pendingRepairs },
    { label: 'Refurbishment', href: '/refurbishment', id: 'refurbishment', icon: faArrowsRotate },
    { label: 'Outsource',     href: '/outsource',     id: 'outsource',     icon: faArrowsRotate },
    { label: 'After-Sales',   href: '/aftersales',    id: 'after_sales',   icon: faShieldHalved },
    { label: 'Finance',       href: '/finance',       id: 'accounting',    icon: faBuildingColumns },
    { label: 'Expenses',      href: '/expenses',      id: 'expenses',      icon: faReceipt },
    { label: role === 'admin' ? 'HR' : role === 'finance' ? 'HR & Payroll' : 'Leave & Performance', href: '/hr', id: 'hr', icon: faUsers },
    { label: 'Settings',      href: '/settings',      id: 'settings',      icon: faGear },
  ]

  const canSeeSettings = role === 'admin'

  return (
    <aside className={`fixed md:relative inset-y-0 left-0 z-50 flex-shrink-0 flex flex-col transition-all duration-300 ease-in-out bg-[var(--bg-surface)] border-r border-[var(--border)] ${
      sidebarOpen 
        ? 'w-64 translate-x-0 ml-0' 
        : 'w-64 -translate-x-full md:w-[72px] md:translate-x-0 md:ml-0'
    }`}>
      <div className={`flex items-center h-[56px] border-b border-[var(--topbar-border)] flex-shrink-0 transition-all duration-300 overflow-hidden whitespace-nowrap ${
        sidebarOpen ? 'px-5' : 'px-5 md:px-0 md:justify-center'
      }`}>
         <span className="font-bold text-xl tracking-wide text-[var(--text-1)]">
           <span className={sidebarOpen ? '' : 'md:hidden'}>Deed ERP</span>
           <span className={sidebarOpen ? 'hidden' : 'hidden md:block'}>D</span>
         </span>
      </div>
      <nav className={`flex flex-col gap-2 flex-1 py-4 transition-all duration-300 ${
        sidebarOpen ? 'px-4 overflow-y-auto overflow-x-hidden' : 'px-4 md:px-3 md:overflow-visible'
      }`}>
        {navItems.filter(item => {
          if (item.id === 'settings') return canSeeSettings
          return hasModuleAccess(currentUser, item.id as ModuleId)
        }).map((item) => {
          const isPathMatch = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href + '/'))
          const isActive = isPathMatch && activeModule === item.id
          
          return (
            <Link 
              key={item.label} 
              href={item.href}
              onClick={() => {
                setModule(item.id as ModuleId)
                if (window.innerWidth < 768 && sidebarOpen) toggleSidebar()
              }}
              className={`group relative flex items-center rounded-xl transition-all whitespace-nowrap ${
                sidebarOpen ? 'px-4 py-2.5' : 'px-4 py-2.5 md:px-0 md:justify-center'
              } ${
                isActive 
                  ? 'bg-[#1B2762] text-white shadow-sm font-semibold' 
                  : 'text-[var(--text-2)] hover:bg-[var(--bg-card)] hover:text-[var(--text-1)] font-medium'
              }`}
            >
              <div className="relative w-[18px] h-[18px] flex items-center justify-center flex-shrink-0">
                <Fa icon={item.icon} className="w-full h-full" />
                {/* Mini Badge for Collapsed View */}
                {!!item.badge && item.badge > 0 && !sidebarOpen && (
                  <span className="absolute -top-2 -right-2.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[8px] font-bold text-white shadow-sm">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className={`text-sm transition-all duration-300 overflow-hidden ${
                sidebarOpen ? 'ml-3 opacity-100 w-auto' : 'md:ml-0 md:opacity-0 md:w-0'
              }`}>
                {item.label}
              </span>

              {/* Full Badge for Expanded View */}
              {!!item.badge && item.badge > 0 && sidebarOpen && (
                <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#EF4444] px-1.5 text-[10px] font-bold text-white shadow-sm">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}

              {/* Custom Tooltip */}
              {!sidebarOpen && (
                <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-[#111827] text-white text-xs font-semibold rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 shadow-md whitespace-nowrap z-[100] pointer-events-none hidden md:block">
                  {item.label}
                  <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 bg-[#111827] rotate-45 -z-10 rounded-[1px]"></div>
                </div>
              )}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
