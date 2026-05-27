'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fa } from '@/components/icons'
import { 
  faChartLine, faShoppingCart, faBuildingColumns, faUsers, faGear, faBoxesStacked, faScrewdriverWrench,
  faDesktop, faGlobe, faAddressBook, faCartShopping, faTruck, faArrowsRotate, faShieldHalved, faReceipt,
  faChevronRight, faChevronLeft
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

interface NavGroup {
  title: string
  items: NavItem[]
}

/**
 * Sidebar Navigation Component
 * Redesigned for a more professional and modern ERP experience.
 */
export default function Sidebar() {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, getVisibleRepairs, users, currentUserId, activeModule, setModule } = useApp()

  const currentUser = users.find(u => u.id === currentUserId)
  const role = currentUser?.role || ''
  const pendingRepairs = getVisibleRepairs().filter(r => ['received', 'assigned'].includes(r.status)).length

  const allItems: NavItem[] = [
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
  const visibleItems = allItems.filter(item => 
    item.id === 'settings' ? canSeeSettings : hasModuleAccess(currentUser, item.id as ModuleId)
  )

  // Grouping items for a better structure
  const groups: NavGroup[] = [
    {
      title: 'General',
      items: visibleItems.filter(i => ['dashboard', 'contacts'].includes(i.id))
    },
    {
      title: 'Commerce',
      items: visibleItems.filter(i => ['sales', 'pos', 'ecommerce', 'kilimall'].includes(i.id))
    },
    {
      title: 'Supply Chain',
      items: visibleItems.filter(i => ['inventory', 'purchase', 'delivery'].includes(i.id))
    },
    {
      title: 'Technical',
      items: visibleItems.filter(i => ['repair', 'refurbishment', 'outsource', 'after_sales'].includes(i.id))
    },
    {
      title: 'Administration',
      items: visibleItems.filter(i => ['accounting', 'expenses', 'hr', 'settings'].includes(i.id))
    }
  ].filter(g => g.items.length > 0)

  return (
    <aside className={`
      fixed md:relative inset-y-0 left-0 z-50 flex-shrink-0 flex flex-col
      transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
      bg-[#0F172A] border-r border-slate-800
      ${sidebarOpen 
        ? 'w-64 translate-x-0 ml-0 shadow-2xl' 
        : 'w-64 -translate-x-full md:w-[78px] md:translate-x-0 md:ml-0'
      }
    `}>
      {/* Brand Header */}
      <div className={`
        flex items-center h-16 border-b border-slate-800/50
        flex-shrink-0 transition-all duration-300 overflow-hidden
        ${sidebarOpen ? 'px-6' : 'px-0 justify-center'}
      `}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <img
              src="/deed-logo.png"
              alt="Deed"
              className="w-6 h-6 object-contain brightness-0 invert"
            />
          </div>
          <div className={`flex flex-col transition-all duration-500 ${sidebarOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 pointer-events-none w-0'}`}>
            <span className="font-bold text-base tracking-tight text-white leading-none">
              DEED <span className="text-accent-400">ERP</span>
            </span>
            <span className="text-[10px] text-slate-400 font-medium tracking-widest uppercase mt-0.5">Technologies</span>
          </div>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-6 scrollbar-none custom-scrollbar">
        {groups.map((group, idx) => (
          <div key={group.title} className={`${idx !== 0 ? 'mt-6' : ''}`}>
            {sidebarOpen && (
              <h3 className="px-6 mb-2 text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em]">
                {group.title}
              </h3>
            )}
            {!sidebarOpen && (
              <div className="px-4 mb-2 flex justify-center">
                <div className="h-px w-8 bg-slate-800" />
              </div>
            )}
            <div className="px-3 space-y-1">
              {group.items.map((item) => (
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
            </div>
          </div>
        ))}
      </div>

      {/* Footer / Collapse Toggle */}
      <div className="p-4 border-t border-slate-800/50 bg-slate-900/30">
        <button
          onClick={toggleSidebar}
          className={`
            hidden md:flex items-center justify-center w-full h-10 rounded-xl
            bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-white
            transition-all duration-200 border border-slate-700/50
          `}
        >
          <Fa icon={sidebarOpen ? faChevronLeft : faChevronRight} className="text-xs" />
          {sidebarOpen && <span className="ml-3 text-xs font-semibold">Collapse Menu</span>}
        </button>
      </div>
    </aside>
  )
}

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
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`
        group relative flex items-center rounded-xl
        transition-all duration-300 ease-out
        ${isExpanded ? 'px-4 py-2.5' : 'h-12 w-12 mx-auto justify-center'}
        ${isActive
          ? 'bg-gradient-to-r from-primary-600/90 to-primary-500/80 text-white shadow-lg shadow-primary-900/50 ring-1 ring-primary-400/20'
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
        }
      `}
    >
      {/* Active Indicator — full-height bar when expanded, shorter dot when collapsed */}
      {isActive && (
        <div className={`absolute left-0 bg-accent-400 rounded-r-full transition-all duration-300 ${isExpanded ? 'w-[3px] top-[18%] bottom-[18%]' : 'w-1 h-6 top-1/2 -translate-y-1/2'}`} />
      )}

      {/* Icon */}
      <div className={`
        flex items-center justify-center flex-shrink-0 transition-transform duration-300
        ${isActive ? 'scale-110' : 'group-hover:scale-110'}
        ${isExpanded ? 'w-5 h-5' : 'w-6 h-6'}
      `}>
        <Fa icon={item.icon} className="w-full h-full" />
      </div>

      {/* Label */}
      <span className={`
        text-[13px] font-semibold whitespace-nowrap transition-all duration-500
        ${isExpanded
          ? 'ml-3 opacity-100 translate-x-0'
          : 'opacity-0 -translate-x-4 pointer-events-none w-0'
        }
      `}>
        {item.label}
      </span>

      {/* Badge */}
      {item.badge && item.badge > 0 && (
        <span className={`
          flex items-center justify-center rounded-full bg-accent-500 text-white font-bold shadow-sm
          ${isExpanded 
            ? 'ml-auto h-5 min-w-[20px] px-1.5 text-[10px]' 
            : 'absolute -top-1 -right-1 h-4 min-w-[16px] px-1 text-[8px] border-2 border-[#0F172A]'
          }
        `}>
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}

      {/* Tooltip (Collapsed View) */}
      {!isExpanded && (
        <div className="
          absolute left-full ml-4 px-3 py-2 bg-slate-800 text-white text-xs font-bold
          rounded-lg opacity-0 invisible group-hover:opacity-100
          group-hover:visible transition-all duration-200 shadow-xl
          whitespace-nowrap z-[100] border border-slate-700
          pointer-events-none translate-x-2 group-hover:translate-x-0
        ">
          {item.label}
          <div className="
            absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-3
            bg-slate-800 border-l border-b border-slate-700 rotate-45 -z-10
          " />
        </div>
      )}
    </Link>
  )
}
