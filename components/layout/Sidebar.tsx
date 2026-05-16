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

interface NavItem {
  label: string
  href: string
  id: ModuleId | 'settings'
  icon: any
  badge?: number
}

/**
 * Sidebar Navigation Component
 * Responsive sidebar with collapsible menu items and active state indicators.
 * On mobile: Overlay drawer that closes on navigation
 * On desktop: Fixed sidebar with collapse/expand toggle
 */
export default function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, getVisibleRepairs, users, currentUserId, activeModule, setModule } = useApp()

  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role || ''
  const pendingRepairs = getVisibleRepairs().filter(r => ['received', 'assigned'].includes(r.status)).length

  const navItems: NavItem[] = [
    { label: 'Dashboard',     href: '/',              id: 'dashboard',     icon: faChartLine },
    { label: 'Sales & CRM',   href: '/sales',         id: 'sales',         icon: faShoppingCart },
    { label: 'POS',           href: '/pos',           id: 'pos',           icon: faDesktop },
    { label: 'E-commerce',    href: '/ecommerce',     id: 'ecommerce',     icon: faGlobe },
    { label: 'Kilimall',      href: '/kilimall',      id: 'kilimall',      icon: faGlobe },
    { label: 'Contacts',      href: '/contacts',      id: 'contacts',      icon: faAddressBook },
    { label: role === 'director' ? 'Operations' : 'Inventory', href: '/operations', id: 'inventory', icon: faBoxesStacked },
    { label: 'Purchases',     href: '/purchases',     id: 'purchase',      icon: faCartShopping },
    { label: 'Delivery',      href: '/delivery',      id: 'delivery',      icon: faTruck },
    { label: 'Repairs',       href: '/repairs',       id: 'repair',        icon: faScrewdriverWrench, badge: pendingRepairs },
    { label: 'Refurbishment', href: '/refurbishment', id: 'refurbishment', icon: faArrowsRotate },
    { label: 'Outsource',     href: '/outsource',     id: 'outsource',     icon: faArrowsRotate },
    { label: 'After-Sales',   href: '/aftersales',    id: 'after_sales',   icon: faShieldHalved },
    { label: 'Finance',       href: '/finance',       id: 'accounting',    icon: faBuildingColumns },
    { label: 'Expenses',      href: '/expenses',      id: 'expenses',      icon: faReceipt },
    { label: role === 'director' ? 'HR' : role === 'finance_officer' ? 'HR & Payroll' : 'Leave & Performance', href: '/hr', id: 'hr', icon: faUsers },
    { label: 'Settings',      href: '/settings',      id: 'settings',      icon: faGear },
  ]

  const canSeeSettings = role === 'director'
  const visibleItems = navItems.filter(item => 
    item.id === 'settings' ? canSeeSettings : hasModuleAccess(currentUser, item.id as ModuleId)
  )

  return (
    <aside className={`
      fixed md:relative inset-y-0 left-0 z-50 flex-shrink-0 flex flex-col
      transition-all duration-300 ease-in-out
      bg-[var(--bg-surface)] border-r border-[var(--border)]
      ${sidebarOpen 
        ? 'w-64 translate-x-0 ml-0' 
        : 'w-64 -translate-x-full md:w-[72px] md:translate-x-0 md:ml-0'
      }
    `}>
      {/* Logo / Brand Header */}
      <div className={`
        flex items-center h-14 border-b border-[var(--topbar-border)]
        flex-shrink-0 transition-all duration-300 overflow-hidden gap-2
        ${sidebarOpen ? 'px-4' : 'px-4 md:px-0 md:justify-center'}
      `}>
        <img
          src="/deed-logo.png"
          alt="Deed"
          width={30}
          height={30}
          className="flex-shrink-0 object-contain"
        />
        <div className={`transition-all duration-300 overflow-hidden ${sidebarOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0 md:hidden'}`}>
          <span className="font-bold text-[13px] tracking-tight text-[var(--text-1)] whitespace-nowrap leading-tight">
            <span className="font-light opacity-50">Tech</span>
          </span>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className={`
        flex flex-col gap-1 flex-1 py-4
        transition-all duration-300
        ${sidebarOpen 
          ? 'px-3 overflow-y-auto overflow-x-hidden' 
          : 'px-3 md:overflow-visible'
        }
      `}>
        {visibleItems.map((item) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            isActive={activeModule === item.id}
            isExpanded={sidebarOpen}
            pathname={pathname}
            onNavigate={() => {
              if (item.id !== 'settings') setModule(item.id)
              if (window.innerWidth < 768 && sidebarOpen) {
                toggleSidebar()
              }
            }}
          />
        ))}
      </nav>
    </aside>
  )
}

/**
 * Individual Navigation Item
 * Displays icon, label, badge, and tooltip on hover
 */
interface SidebarNavItemProps {
  item: NavItem
  isActive: boolean
  isExpanded: boolean
  pathname: string
  onNavigate: () => void
}

function SidebarNavItem({
  item,
  isActive,
  isExpanded,
  pathname,
  onNavigate,
}: SidebarNavItemProps) {
  const isPathMatch = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href + '/'))

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      style={isActive ? { background: '#1B2762', boxShadow: '0 1px 4px rgba(27,39,98,0.20)' } : undefined}
      className={`
        group relative flex items-center rounded-lg
        transition-all duration-200 whitespace-nowrap
        ${isExpanded ? 'px-3 py-2.5' : 'px-3 py-2.5 md:px-0 md:justify-center'}
        ${isActive
          ? 'text-white font-semibold'
          : 'text-[var(--text-2)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-1)] font-medium'
        }
      `}
    >
      {/* Icon Container */}
      <div className="relative w-[18px] h-[18px] flex items-center justify-center flex-shrink-0">
        <Fa icon={item.icon} className="w-full h-full" />
        
        {/* Badge - Collapsed View */}
        {item.badge && item.badge > 0 && !isExpanded && (
          <span className="
            absolute -top-2 -right-2.5 flex h-3.5 min-w-[14px]
            items-center justify-center rounded-full
            bg-red-500 px-1 text-[8px] font-bold text-white
            shadow-sm
          ">
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </div>

      {/* Label - Expanded View */}
      <span className={`
        text-sm transition-all duration-300 overflow-hidden
        ${isExpanded
          ? 'ml-3 opacity-100 w-auto'
          : 'md:ml-0 md:opacity-0 md:w-0'
        }
      `}>
        {item.label}
      </span>

      {/* Badge - Expanded View */}
      {item.badge && item.badge > 0 && isExpanded && (
        <span className="
          ml-auto flex h-5 min-w-[20px] items-center justify-center
          rounded-full bg-red-500 px-1.5 text-[10px] font-bold
          text-white shadow-sm
        ">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}

      {/* Tooltip - Collapsed View */}
      {!isExpanded && (
        <div className="
          absolute left-full ml-3 top-1/2 -translate-y-1/2
          px-2.5 py-1.5 bg-gray-900 text-white text-xs font-semibold
          rounded-lg opacity-0 invisible group-hover:opacity-100
          group-hover:visible transition-all duration-200 shadow-lg
          whitespace-nowrap z-[100] pointer-events-none hidden md:block
        ">
          {item.label}
          <div className="
            absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2
            bg-gray-900 rotate-45 -z-10 rounded-[1px]
          " />
        </div>
      )}
    </Link>
  )
}
